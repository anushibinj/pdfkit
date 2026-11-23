/**
 * Pure request dispatcher for the Compare PDFs Web Worker.
 */
import { errorMessage, isOutOfMemory } from "@/lib/errors";
import { PdfOpenError, type RenderedPage } from "@/lib/pdfium/pdfium-document";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { DocSide } from "../core/model";
import type {
  ComputedVisualDiff,
  OpenSideOutcome,
} from "../engine/compare-session";
import type {
  CompareErrorResult,
  CompareRequest,
  CompareWorkerResult,
} from "../messages";

/** Narrow session interface required by {@link handleCompareRequest}. */
export interface CompareSessionPort {
  openSide(
    side: DocSide,
    fileName: string,
    bytes: Uint8Array,
    password: string,
    onProgress?: (fraction: number, stage: string) => void,
  ): OpenSideOutcome;
  renderPage(
    side: DocSide,
    pageIndex: number,
    requestedWidth: number,
  ): RenderedPage;
  computeVisualDiff(
    pairIndex: number,
    requestedWidth: number,
    threshold?: number,
  ): ComputedVisualDiff;
  buildReport(): Uint8Array;
  closeSide(side: DocSide): void;
  closeAll(): void;
}

/**
 * Classify an exception thrown inside the Compare worker into a typed
 * {@link CompareErrorResult}.
 *
 * @param err Any thrown value.
 * @returns Error result distinguishing OOM, WASM traps, and ordinary failures.
 */
export function toCompareErrorResult(err: unknown): CompareErrorResult {
  if (isOutOfMemory(err)) {
    return {
      status: "error",
      reason: "out-of-memory",
      message:
        "The browser ran out of memory while comparing these PDFs. Close other tabs, or try smaller files.",
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
 * Execute one {@link CompareRequest} against `session`.
 *
 * @param session Active comparison session.
 * @param request Request payload from main thread.
 * @param ctx Progress reporting callback.
 * @returns Response payload and transferable buffer list.
 */
export async function handleCompareRequest(
  session: CompareSessionPort,
  request: CompareRequest,
  ctx: HandlerContext,
): Promise<HandlerResult<CompareWorkerResult>> {
  switch (request.op) {
    case "open": {
      try {
        const outcome = session.openSide(
          request.side,
          request.fileName,
          new Uint8Array(request.data),
          request.password,
          (fraction, stage) => ctx.progress(fraction, stage),
        );
        return {
          result: {
            status: "opened",
            side: outcome.side,
            pageCount: outcome.pageCount,
            scannedPages: outcome.scannedPages,
            summary: outcome.summary,
          },
        };
      } catch (err) {
        if (err instanceof PdfOpenError && err.reason === "password") {
          return {
            result: {
              status: "needs-password",
              side: request.side,
              wrong: request.password.length > 0,
            },
          };
        }
        if (err instanceof PdfOpenError) {
          return {
            result: { status: "error", reason: "failed", message: err.message },
          };
        }
        throw err;
      }
    }

    case "render": {
      if (
        !Number.isInteger(request.pageIndex) ||
        typeof request.width !== "number"
      ) {
        throw new Error("Invalid render request.");
      }
      const rendered = session.renderPage(
        request.side,
        request.pageIndex,
        request.width,
      );
      const pixels = toTransferableBuffer(rendered.pixels);
      return {
        result: {
          status: "rendered",
          width: rendered.width,
          height: rendered.height,
          pixels,
        },
        transfer: [pixels],
      };
    }

    case "visual-diff": {
      if (
        !Number.isInteger(request.pairIndex) ||
        typeof request.width !== "number"
      ) {
        throw new Error("Invalid visual diff request.");
      }
      const diff = session.computeVisualDiff(
        request.pairIndex,
        request.width,
        request.threshold,
      );
      const pixels = toTransferableBuffer(diff.pixels);
      return {
        result: {
          status: "visual-diff",
          pixels,
          summary: diff.summary,
        },
        transfer: [pixels],
      };
    }

    case "build-report": {
      ctx.progress(0.3, "Generating comparison report PDF…");
      const bytes = session.buildReport();
      const data = toTransferableBuffer(bytes);
      ctx.progress(1, "Report ready");
      return {
        result: { status: "report", data },
        transfer: [data],
      };
    }

    case "close-side":
      session.closeSide(request.side);
      return { result: { status: "closed" } };

    case "close-all":
      session.closeAll();
      return { result: { status: "closed" } };

    default:
      return {
        result: {
          status: "error",
          reason: "failed",
          message: "Unknown compare worker request.",
        },
      };
  }
}

/**
 * Create the top-level worker message handler wired with lazy PDFium loading
 * and uniform error conversion.
 *
 * @param getSession Lazy memoised session factory.
 * @returns Worker handler compatible with `exposeWorker`.
 */
export function createCompareHandler(
  getSession: () => Promise<CompareSessionPort>,
): (
  request: CompareRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<CompareWorkerResult>> {
  return async (request, ctx) => {
    let session: CompareSessionPort;
    try {
      session = await getSession();
    } catch (err) {
      if (request.op === "close-side" || request.op === "close-all") {
        return { result: { status: "closed" } };
      }
      return {
        result: {
          status: "error",
          reason: "failed",
          message: `Could not load the PDF engine: ${errorMessage(err)}`,
        },
      };
    }

    try {
      return await handleCompareRequest(session, request, ctx);
    } catch (err) {
      return { result: toCompareErrorResult(err) };
    }
  };
}
