import { errorMessage, isOutOfMemory } from "@/lib/errors";
import type { PageInfo, RenderedPage } from "@/lib/pdfium/pdfium-document";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import { InvalidCropPlanError } from "../core/crop-plan";
import {
  CropModuleError,
  EncryptedPdfError,
  type CropOutcome,
  type CropStage,
} from "../engine/crop-session";
import { CropVerificationError } from "../engine/crop-verifier";
import type { CropRequest, CropWorkerResult, ErrorResult } from "../messages";

/** What the handler needs from the worker's session (`CropSession`). */
export interface Session {
  open(bytes: Uint8Array): PageInfo[];
  render(pageIndex: number, width: number): RenderedPage;
  crop(
    plan: unknown,
    onProgress?: (stage: CropStage, fraction: number) => void,
  ): Promise<CropOutcome>;
  close(): void;
}

/**
 * Turn a thrown value into a typed error result.
 *
 * - Memory exhaustion gets its own reason and an actionable message.
 * - A `WebAssembly.RuntimeError` is a trap in one of the engines (an
 *   assertion, an out-of-bounds access). Its memory is then in an unknown
 *   state, so the UI must start a new worker: reason "crashed".
 * - Everything else is an ordinary failure; the worker stays usable.
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
        "The browser ran out of memory while cropping this PDF. Close other tabs, or try a smaller file.",
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
  if (err instanceof InvalidCropPlanError) {
    return {
      status: "error",
      reason: "failed",
      message: `The crop settings are invalid: ${err.message}.`,
    };
  }
  return { status: "error", reason: "failed", message: errorMessage(err) };
}

/**
 * Run one request against the session.
 *
 * Inputs are re-checked where the session does not: a page index or width
 * that is not a number is refused. The crop plan is checked by the session.
 * Results are typed per request; known failures (an encrypted file, a
 * crop whose check failed) get their own status so the UI can phrase them.
 *
 * @param session The worker's session.
 * @param request The request.
 * @param ctx Reports progress of a crop.
 * @returns The result and the buffers to transfer back.
 */
export async function handleRequest(
  session: Session,
  request: CropRequest,
  ctx: HandlerContext,
): Promise<HandlerResult<CropWorkerResult>> {
  switch (request.op) {
    case "open": {
      try {
        const pages = session.open(new Uint8Array(request.data));
        return { result: { status: "opened", pages } };
      } catch (err) {
        if (err instanceof EncryptedPdfError) {
          return { result: { status: "encrypted", message: err.message } };
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
      const page = session.render(request.pageIndex, request.width);
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
    case "crop": {
      try {
        const outcome = await session.crop(request.plan, (stage, fraction) =>
          ctx.progress(fraction, stage),
        );
        const data = toTransferableBuffer(outcome.pdf);
        return {
          result: {
            status: "cropped",
            data,
            report: outcome.report,
            verified: outcome.verified,
          },
          transfer: [data],
        };
      } catch (err) {
        if (err instanceof CropVerificationError) {
          return {
            result: {
              status: "check-failed",
              pageIndex: err.pageIndex,
              message: err.message,
            },
          };
        }
        if (err instanceof CropModuleError) {
          return {
            result: { status: "error", reason: "failed", message: err.message },
          };
        }
        throw err;
      }
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
export function createCropHandler(
  getSession: () => Promise<Session>,
): (
  request: CropRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<CropWorkerResult>> {
  return async (request, ctx) => {
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
      return await handleRequest(session, request, ctx);
    } catch (err) {
      return { result: toErrorResult(err) };
    }
  };
}
