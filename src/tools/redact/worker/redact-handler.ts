import { errorMessage, isOutOfMemory } from "@/lib/errors";
import type { PageBox } from "@/lib/pdfium/page-box";
import type { PageInfo, RenderedPage } from "@/lib/pdfium/pdfium-document";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { RedactionMark } from "../core/model";
import { InvalidRedactionPlanError } from "../core/sanitize-plan";
import {
  RedactModuleError,
  type RedactOutcome,
  type RedactStage,
} from "../engine/redact-session";
import { RedactionVerificationError } from "../engine/redaction-verifier";
import type {
  RedactErrorResult,
  RedactRequest,
  RedactWorkerResult,
  SearchQuery,
} from "../messages";

/** Narrow session contract consumed by {@link handleRequest} (ISP & DIP). */
export interface RedactWorkerSession {
  open(bytes: Uint8Array, password: string): PageInfo[];
  render(pageIndex: number, width: number): RenderedPage;
  textUnderBox(pageIndex: number, box: PageBox): string;
  search(query: SearchQuery): Omit<RedactionMark, "id">[];
  applyRedactions(
    plan: unknown,
    onProgress?: (stage: RedactStage, fraction: number) => void,
  ): Promise<RedactOutcome>;
  close(): void;
}

/**
 * Convert any thrown exception from the worker into a typed {@link RedactErrorResult}.
 *
 * @param err Thrown error value.
 * @returns Structured error result classifying OOM, WASM crashes, and validation errors.
 */
export function toErrorResult(err: unknown): RedactErrorResult {
  if (isOutOfMemory(err)) {
    return {
      status: "error",
      reason: "out-of-memory",
      message:
        "The browser ran out of memory while redacting this PDF. Close other tabs, or try a smaller file.",
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
  if (err instanceof InvalidRedactionPlanError) {
    return {
      status: "error",
      reason: "failed",
      message: `The redaction plan is invalid: ${err.message}.`,
    };
  }
  return { status: "error", reason: "failed", message: errorMessage(err) };
}

/**
 * Dispatch one typed worker request against `session` and collect transferable
 * buffers for zero-copy response delivery.
 *
 * @param session Active {@link RedactWorkerSession}.
 * @param request Incoming worker request.
 * @param ctx Worker handler context used to emit progress updates.
 * @returns Structured response and optional transferable `ArrayBuffer` list.
 */
export async function handleRequest(
  session: RedactWorkerSession,
  request: RedactRequest,
  ctx: HandlerContext,
): Promise<HandlerResult<RedactWorkerResult>> {
  switch (request.op) {
    case "open": {
      try {
        const pages = session.open(
          new Uint8Array(request.data),
          request.password,
        );
        return { result: { status: "opened", pages } };
      } catch (err) {
        if (err instanceof PdfOpenError && err.reason === "password") {
          return {
            result: {
              status: "needs-password",
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
    case "text-under-box": {
      if (!Number.isInteger(request.pageIndex)) {
        throw new Error("Invalid text-under-box request.");
      }
      const text = session.textUnderBox(request.pageIndex, request.box);
      return { result: { status: "text-extracted", text } };
    }
    case "search": {
      const matches = session.search(request.query);
      return { result: { status: "searched", matches } };
    }
    case "apply": {
      try {
        const outcome = await session.applyRedactions(
          request.plan,
          (stage, fraction) => ctx.progress(fraction, stage),
        );
        const data = toTransferableBuffer(outcome.pdf);
        return {
          result: {
            status: "redacted",
            data,
            report: outcome.report,
          },
          transfer: [data],
        };
      } catch (err) {
        if (err instanceof RedactionVerificationError) {
          return {
            result: {
              status: "verification-failed",
              verification: err.report,
              message: err.message,
            },
          };
        }
        if (err instanceof RedactModuleError) {
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
 * Create the request handler registered with `exposeWorker`.
 *
 * @param getSession Memoised lazy session factory.
 * @returns Async handler returning typed worker responses without throwing.
 */
export function createRedactHandler(
  getSession: () => Promise<RedactWorkerSession>,
): (
  request: RedactRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<RedactWorkerResult>> {
  return async (request, ctx) => {
    let session: RedactWorkerSession;
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
      return { result: { ...toErrorResult(err) } };
    }
  };
}
