import { errorMessage, isOutOfMemory } from "@/lib/errors";
import { PdfOpenError } from "@/lib/pdfium/document";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type {
  PageImageEntry,
  RenderedPageImage,
} from "../engine/images-session";
import type {
  ErrorResult,
  ImagesRequest,
  ImagesResult,
  WireImageEntry,
} from "../messages";

/** What the handler needs from the worker's session (`ImagesSession`). */
export interface Session {
  open(bytes: Uint8Array, password: string): number;
  renderPage(pageIndex: number, options: unknown): Promise<RenderedPageImage>;
  extractImages(
    pageIndex: number,
    knownKeys: readonly string[],
  ): Promise<PageImageEntry[]>;
  close(): void;
}

/**
 * Turn a thrown value into a typed error result.
 *
 * - Memory exhaustion gets its own reason and an actionable message.
 * - A `WebAssembly.RuntimeError` is a trap; afterwards the engine's memory
 *   is in an unknown state, so the UI must start a new worker: "crashed".
 * - Anything else (a missing page, an engine that could not render) is an
 *   ordinary failure and the worker stays usable.
 *
 * @param err The thrown value.
 * @returns An error result.
 */
export function toErrorResult(err: unknown): ErrorResult {
  if (isOutOfMemory(err)) {
    return {
      status: "error",
      reason: "out-of-memory",
      message:
        "The browser ran out of memory while working on this PDF. Choose a lower resolution, close other tabs, or try a smaller file.",
    };
  }
  if (
    typeof WebAssembly !== "undefined" &&
    err instanceof WebAssembly.RuntimeError
  ) {
    return {
      status: "error",
      reason: "crashed",
      message: `The PDF engine stopped unexpectedly (${err.message}). It has been restarted; please try again.`,
    };
  }
  return { status: "error", reason: "failed", message: errorMessage(err) };
}

/**
 * Keep only the strings of an untrusted list.
 *
 * @param value Anything a message carried.
 * @returns The string items, or [] when it is not an array.
 */
export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Convert session entries to wire entries, moving each file's bytes into a
 * buffer that can be transferred (not copied) to the main thread.
 *
 * @param entries The session's entries for one page.
 * @returns The wire entries and the buffers to transfer.
 */
export function toWireEntries(entries: PageImageEntry[]): {
  entries: WireImageEntry[];
  transfer: ArrayBuffer[];
} {
  const transfer: ArrayBuffer[] = [];
  const wire = entries.map((entry): WireImageEntry => {
    if (entry.kind !== "image") return entry;
    const { bytes, ...rest } = entry;
    const data = toTransferableBuffer(bytes);
    transfer.push(data);
    return { ...rest, data };
  });
  return { entries: wire, transfer };
}

/**
 * Run one request against the session.
 *
 * Inputs are re-checked because a message can carry anything: a missing
 * password becomes "" (none), a key list keeps only strings, and the render
 * options are sanitised by the session. For "open", a password error is
 * split in two so the UI can phrase it: no password given means "this file
 * needs one", a refused password means "that one is wrong".
 *
 * @param session The worker's session.
 * @param request The request.
 * @returns The result and the buffers to transfer back.
 */
export async function handleRequest(
  session: Session,
  request: ImagesRequest,
): Promise<HandlerResult<ImagesResult>> {
  switch (request.op) {
    case "open": {
      const password =
        typeof request.password === "string" ? request.password : "";
      try {
        const pageCount = session.open(new Uint8Array(request.data), password);
        return { result: { status: "opened", pageCount } };
      } catch (err) {
        if (err instanceof PdfOpenError && err.reason === "password") {
          return {
            result: {
              status: password === "" ? "password-required" : "wrong-password",
            },
          };
        }
        if (err instanceof PdfOpenError) {
          return {
            result: { status: "error", reason: "failed", message: err.message },
          };
        }
        return { result: toErrorResult(err) };
      }
    }
    case "render-page": {
      const { bytes, ...page } = await session.renderPage(
        request.pageIndex,
        request.options,
      );
      const data = toTransferableBuffer(bytes);
      return { result: { status: "page", ...page, data }, transfer: [data] };
    }
    case "extract-images": {
      const found = await session.extractImages(
        request.pageIndex,
        stringList(request.knownKeys),
      );
      const { entries, transfer } = toWireEntries(found);
      return {
        result: { status: "images", pageIndex: request.pageIndex, entries },
        transfer,
      };
    }
    case "close":
      session.close();
      return { result: { status: "closed" } };
    default:
      return {
        result: {
          status: "error",
          reason: "failed",
          message: "Unknown request.",
        },
      };
  }
}

/**
 * Build the function the worker exposes with `exposeWorker`.
 *
 * Requests run strictly one after another. `exposeWorker` starts a handler
 * call for every message as it arrives, and extracting images awaits
 * (hashing, encoding) while a PDFium page is loaded. Were a "close" or an
 * "open" to run in such a gap, PDFium would free the document under the
 * loaded page. So each request is chained behind the previous one
 * (`queue`); the chain always continues, because every request resolves
 * to a result instead of rejecting.
 *
 * Flow for one request:
 * 1. Get the session. The first request downloads and compiles PDFium,
 *    which can fail (offline, blocked): reported as "Could not load the
 *    PDF engine". A "close" needs no engine.
 * 2. Run it; every exception becomes a typed error result.
 *
 * @param getSession Resolves to the session (memoised by the caller).
 * @returns The request handler.
 */
export function createImagesHandler(
  getSession: () => Promise<Session>,
): (
  request: ImagesRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<ImagesResult>> {
  let queue: Promise<unknown> = Promise.resolve();
  const run = async (
    request: ImagesRequest,
  ): Promise<HandlerResult<ImagesResult>> => {
    let session: Session;
    try {
      session = await getSession();
    } catch (err) {
      if (request.op === "close") return { result: { status: "closed" } };
      return {
        result: {
          status: "error",
          reason: "failed",
          message: `Could not load the PDF engine: ${errorMessage(err)}`,
        },
      };
    }
    try {
      return await handleRequest(session, request);
    } catch (err) {
      return { result: toErrorResult(err) };
    }
  };
  return (request) => {
    const next = queue.then(() => run(request));
    queue = next.catch(() => {});
    return next;
  };
}
