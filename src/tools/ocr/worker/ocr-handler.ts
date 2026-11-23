/**
 * Worker message dispatcher and handler for the OCR PDF tool.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Handles worker request routing, transferable buffers,
 *   progress forwarding, and out-of-memory / error mapping.
 * - Dependency Inversion: Accepts an abstract `OcrSessionProvider`.
 */

import { errorMessage, isOutOfMemory } from "@/lib/errors";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { OcrOptions, OcrOutcome } from "../core/model";
import type { OcrCancelToken } from "../engine/ocr-session";
import type { OcrRequest, OcrWorkerResult } from "../messages";

/** Minimal session contract consumed by the worker handler (ISP). */
export interface OcrWorkerSession {
  run(
    inputBytes: Uint8Array,
    options: OcrOptions,
    password?: string,
    onProgress?: (fraction: number, stage: string) => void,
    cancelToken?: OcrCancelToken,
  ): Promise<OcrOutcome>;
}

/** Asynchronous factory returning an initialized {@link OcrWorkerSession}. */
export type OcrSessionProvider = () => Promise<OcrWorkerSession>;

/**
 * Builds the message handler registered via `exposeWorker`.
 *
 * @param getSession Lazy singleton session provider.
 * @returns Worker request handler processing {@link OcrRequest} payloads.
 */
export function createOcrHandler(
  getSession: OcrSessionProvider,
): (
  payload: OcrRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<OcrWorkerResult>> {
  return async (
    payload: OcrRequest,
    ctx: HandlerContext,
  ): Promise<HandlerResult<OcrWorkerResult>> => {
    if (payload.op === "ping") {
      return { result: { status: "pong" } };
    }

    if (payload.op !== "ocr") {
      return {
        result: {
          status: "error",
          message: `Unknown operation: ${(payload as { op: string }).op}`,
        },
      };
    }

    try {
      ctx.progress(0.02, "Loading OCR engine…");
      const session = await getSession();
      const inputBytes = new Uint8Array(payload.data);

      const outcome = await session.run(
        inputBytes,
        payload.options,
        payload.password ?? "",
        (fraction, stage) => ctx.progress(fraction, stage),
        { cancelled: false },
      );

      switch (outcome.kind) {
        case "completed": {
          const buffer = toTransferableBuffer(outcome.pdf);
          return {
            result: {
              status: "completed",
              data: buffer,
              report: outcome.report,
              wasImageInput: outcome.wasImageInput,
            },
            transfer: [buffer],
          };
        }
        case "password-required":
          return {
            result: {
              status: "password-required",
              wrongPassword: outcome.wrongPassword,
            },
          };
        case "cancelled":
          return {
            result: {
              status: "cancelled",
            },
          };
        case "failed":
          return {
            result: {
              status: "error",
              message: outcome.message,
            },
          };
      }
    } catch (err: unknown) {
      if (isOutOfMemory(err)) {
        return {
          result: {
            status: "error",
            message:
              "The browser ran out of memory while running OCR. Try 150 or 200 DPI or close other tabs.",
          },
        };
      }
      return {
        result: {
          status: "error",
          message:
            errorMessage(err) || "An unexpected error occurred during OCR.",
        },
      };
    }
  };
}
