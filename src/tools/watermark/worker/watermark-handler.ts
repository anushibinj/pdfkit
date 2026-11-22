import { errorMessage, isOutOfMemory } from "@/lib/errors";
import type { RenderedPage } from "@/lib/pdfium/pdfium-document";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type {
  ErrorResult,
  WatermarkRequest,
  WatermarkResult,
} from "../messages";

/** What the handler needs from the worker's session (`WatermarkSession`). */
export interface Session {
  open(bytes: Uint8Array, password: string): number;
  preview(pageIndex: number, width: number, settings?: unknown): RenderedPage;
  apply(settings: unknown, pages: unknown): Uint8Array;
  close(): void;
}

/**
 * Turn a thrown value into a typed error result.
 *
 * - Memory exhaustion gets its own reason and an actionable message.
 * - A `WebAssembly.RuntimeError` is a trap (a C++ assertion, an
 *   out-of-bounds access). Afterwards the engine's memory is in an unknown
 *   state, so the UI must start a new worker: reason "crashed".
 * - Anything else (invalid settings, a file qpdf cannot read) is an
 *   ordinary failure whose message is already written for the user; the
 *   worker stays usable.
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
        "The browser ran out of memory while working on this PDF. Close other tabs, or try a smaller file.",
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
 * Run one request against the session.
 *
 * Inputs are re-checked here because a message can carry anything: a
 * missing password becomes "" (none). Settings and page lists are checked
 * by the session itself (`sanitizeSettings`, `sanitizePageIndices`).
 *
 * For "open", a password error is split in two so the UI can phrase it:
 * no password given means "this file needs one", a given password that
 * PDFium refuses means "that one is wrong".
 *
 * @param session The worker's session.
 * @param request The request.
 * @returns The result and the buffers to transfer back.
 */
export function handleRequest(
  session: Session,
  request: WatermarkRequest,
): HandlerResult<WatermarkResult> {
  switch (request.op) {
    case "open": {
      const password =
        typeof request.password === "string" ? request.password : "";
      try {
        const pageCount = session.open(new Uint8Array(request.data), password);
        return { result: { status: "opened", pageCount } };
      } catch (err) {
        if (err instanceof PdfOpenError) {
          if (err.reason === "password") {
            return {
              result: {
                status:
                  password === "" ? "password-required" : "wrong-password",
              },
            };
          }
          return {
            result: { status: "error", reason: "failed", message: err.message },
          };
        }
        return { result: toErrorResult(err) };
      }
    }
    case "preview": {
      const page = session.preview(
        request.pageIndex,
        request.width,
        request.settings,
      );
      const pixels = toTransferableBuffer(page.pixels);
      return {
        result: {
          status: "rendered",
          width: page.width,
          height: page.height,
          pixels,
        },
        transfer: [pixels],
      };
    }
    case "apply": {
      const data = toTransferableBuffer(
        session.apply(request.settings, request.pages),
      );
      return { result: { status: "watermarked", data }, transfer: [data] };
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
 * Flow for one request:
 * 1. Get the session. The first request downloads and compiles PDFium and
 *    qpdf, which can fail (offline, blocked); that is reported as "Could
 *    not load the PDF engine" instead of a raw error. A "close" needs no
 *    engine.
 * 2. Run the request. Every exception becomes a typed result, so the
 *    promise never rejects and the UI handles one shape per request.
 *
 * @param getSession Resolves to the session (memoised by the caller).
 * @returns The request handler.
 */
export function createWatermarkHandler(
  getSession: () => Promise<Session>,
): (
  request: WatermarkRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<WatermarkResult>> {
  return async (request) => {
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
      return handleRequest(session, request);
    } catch (err) {
      return { result: toErrorResult(err) };
    }
  };
}
