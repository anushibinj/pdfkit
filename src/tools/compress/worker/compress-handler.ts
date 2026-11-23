/**
 * Worker message dispatcher and handler for PDF compression and preview rendering.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Handles worker request routing, transferable buffers,
 *   progress forwarding, and error mapping.
 * - Dependency Inversion: Accepts an abstract `CompressSessionProvider`.
 */

import { errorMessage, isOutOfMemory } from "@/lib/errors";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { CompressOptions, CompressOutcome } from "../core/model";
import type { PreviewPairResult } from "../engine/pdfium-image-extractor";
import type { CompressRequest, CompressWorkerResult } from "../messages";

/** Minimal session contract consumed by the worker handler (ISP). */
export interface CompressWorkerSession {
  compress(
    bytes: Uint8Array,
    options: CompressOptions,
    password?: string,
    onProgress?: (fraction: number, stage: string) => void,
  ): Promise<CompressOutcome>;
  renderPreview(
    originalBytes: Uint8Array,
    compressedBytes: Uint8Array,
    pageIndex: number,
    width: number,
    password?: string,
  ): PreviewPairResult;
}

/** Asynchronous factory returning an initialized {@link CompressWorkerSession}. */
export type CompressSessionProvider = () => Promise<CompressWorkerSession>;

/**
 * Builds the message handler registered via `exposeWorker`.
 *
 * @param getSession Lazy singleton session provider.
 * @returns Worker request handler processing {@link CompressRequest} payloads.
 */
export function createCompressHandler(
  getSession: CompressSessionProvider,
): (
  payload: CompressRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<CompressWorkerResult>> {
  return async (
    payload: CompressRequest,
    ctx: HandlerContext,
  ): Promise<HandlerResult<CompressWorkerResult>> => {
    if (payload.op === "ping") {
      return { result: { status: "pong" } };
    }

    try {
      const session = await getSession();

      if (payload.op === "preview") {
        const pair = session.renderPreview(
          new Uint8Array(payload.originalData),
          new Uint8Array(payload.compressedData),
          payload.pageIndex,
          payload.width,
          payload.password ?? "",
        );
        const originalPixels = toTransferableBuffer(pair.originalPixels);
        const compressedPixels = toTransferableBuffer(pair.compressedPixels);
        return {
          result: {
            status: "preview-rendered",
            pageIndex: pair.pageIndex,
            pageCount: pair.pageCount,
            width: pair.width,
            height: pair.height,
            originalPixels,
            compressedPixels,
          },
          transfer: [originalPixels, compressedPixels],
        };
      }

      if (payload.op !== "compress") {
        return {
          result: {
            status: "error",
            message: `Unknown operation: ${(payload as { op: string }).op}`,
          },
        };
      }

      ctx.progress(0.05, "Loading compression engine…");
      const inputBytes = new Uint8Array(payload.data);
      const outcome = await session.compress(
        inputBytes,
        payload.options,
        payload.password ?? "",
        (fraction, stage) => ctx.progress(fraction, stage),
      );

      if (outcome.kind === "compressed") {
        const buffer = toTransferableBuffer(outcome.pdf);
        return {
          result: {
            status: "compressed",
            data: buffer,
            pageCount: outcome.pageCount,
            originalBytes: outcome.originalBytes,
            compressedBytes: outcome.compressedBytes,
            report: outcome.report,
            appliedConfig: outcome.appliedConfig,
            targetEvaluation: outcome.targetEvaluation,
            warnings: outcome.warnings,
          },
          transfer: [buffer],
        };
      }

      if (outcome.kind === "password-required") {
        return {
          result: {
            status: "password-required",
            wrongPassword: outcome.wrongPassword,
          },
        };
      }

      return {
        result: {
          status: "error",
          message: outcome.message,
        },
      };
    } catch (err: unknown) {
      if (isOutOfMemory(err)) {
        return {
          result: {
            status: "error",
            message:
              "The browser ran out of memory while compressing this PDF. Try a smaller file or close other tabs.",
          },
        };
      }
      return {
        result: {
          status: "error",
          message:
            errorMessage(err) || "An unexpected error occurred during compression.",
        },
      };
    }
  };
}
