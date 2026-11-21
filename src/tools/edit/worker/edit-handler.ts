import { errorMessage, isOutOfMemory } from "@/lib/errors";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { PageInfo, QuarterTurns } from "../core/model";
import { isQuarterTurns } from "../core/page-geometry";
import { InvalidPlanError } from "../core/sanitize-plan";
import type { TextRun } from "../core/text-runs";
import type { PageRender } from "../engine/editor-session";
import { PdfOpenError } from "../engine/pdfium-document";
import type {
  EditorRequest,
  EditorResult,
  ErrorResult,
  OpenResult,
} from "../messages";

/** What the handler needs from the worker's session (`EditorSession`). */
export interface Session {
  open(bytes: Uint8Array, password: string): PageInfo[];
  render(
    pageIndex: number,
    turns: QuarterTurns,
    width: number,
    textEdits: unknown,
  ): PageRender;
  textRuns(pageIndex: number): TextRun[];
  save(plan: unknown): Uint8Array;
  close(): void;
}

/**
 * Turn a thrown value into a typed error result.
 *
 * - Memory exhaustion gets its own reason and an actionable message.
 * - A `WebAssembly.RuntimeError` is a trap (a C++ assertion, an
 *   out-of-bounds access). After a trap the engine's memory is in an unknown
 *   state, so the UI must start a new worker: reason "crashed".
 * - A rejected save plan, or anything else PDFium reports, is an ordinary
 *   failure and the worker stays usable.
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
  if (err instanceof InvalidPlanError) {
    return {
      status: "error",
      reason: "failed",
      message: `Could not save the edits: ${err.message}`,
    };
  }
  return { status: "error", reason: "failed", message: errorMessage(err) };
}

/**
 * Open a file and describe the outcome as an {@link OpenResult}. Shared by
 * every PDFium tool's worker (the editor and the page organizer).
 *
 * The password is re-checked because a message can carry anything: a
 * missing or non-string password becomes "" (none). A password error is
 * split in two so the UI can phrase it right: no password given means
 * "this file needs one", a given password that PDFium refuses means "that
 * one is wrong". Any other open failure is an ordinary error, except
 * memory exhaustion and engine traps, classified by {@link toErrorResult}.
 *
 * @param open Opens the file with the given password and returns its pages.
 * @param rawPassword The password as received.
 * @returns The outcome.
 */
export function openResult(
  open: (password: string) => PageInfo[],
  rawPassword: unknown,
): OpenResult {
  const password = typeof rawPassword === "string" ? rawPassword : "";
  try {
    return { status: "opened", pages: open(password) };
  } catch (err) {
    if (err instanceof PdfOpenError) {
      if (err.reason === "password") {
        return {
          status: password === "" ? "password-required" : "wrong-password",
        };
      }
      return { status: "error", reason: "failed", message: err.message };
    }
    return toErrorResult(err);
  }
}

/**
 * Run one request against the session.
 *
 * Inputs are re-checked here because a message can carry anything: an
 * unknown rotation becomes 0, a missing password becomes "" (none). The
 * save plan and text edits are checked by the session itself
 * (`sanitizeSavePlan`, `sanitizeTextEdits`).
 *
 * @param session The worker's session.
 * @param request The request.
 * @returns The result and the buffers to transfer back.
 */
export function handleRequest(
  session: Session,
  request: EditorRequest,
): HandlerResult<EditorResult> {
  switch (request.op) {
    case "open":
      return {
        result: openResult(
          (password) => session.open(new Uint8Array(request.data), password),
          request.password,
        ),
      };
    case "render": {
      const turns = isQuarterTurns(request.rotation) ? request.rotation : 0;
      const page = session.render(
        request.pageIndex,
        turns,
        request.width,
        request.textEdits ?? [],
      );
      const pixels = toTransferableBuffer(page.pixels);
      return {
        result: {
          status: "rendered",
          width: page.width,
          height: page.height,
          pixels,
          textOutcomes: page.textOutcomes,
        },
        transfer: [pixels],
      };
    }
    case "text-runs":
      return {
        result: {
          status: "text-runs",
          runs: session.textRuns(request.pageIndex),
        },
      };
    case "save": {
      const data = toTransferableBuffer(session.save(request.plan));
      return { result: { status: "saved", data }, transfer: [data] };
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
 * 1. Get the session. The first request downloads and compiles PDFium,
 *    which can fail (offline, blocked); that is reported as "Could not load
 *    the PDF engine" instead of a raw error. A "close" needs no engine.
 * 2. Run the request. Every exception becomes a typed result, so the
 *    promise never rejects and the UI handles one shape per request.
 *
 * @param getSession Resolves to the session (memoised by the caller).
 * @returns The request handler.
 */
export function createEditHandler(
  getSession: () => Promise<Session>,
): (
  request: EditorRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<EditorResult>> {
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
