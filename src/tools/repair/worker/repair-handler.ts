/**
 * Worker message dispatcher and handler for PDF repair operations.
 *
 * Implements SOLID Principles:
 * - Single Responsibility: Handles worker request routing, memory transfer, and error formatting.
 * - Dependency Inversion: Accepts an abstract session provider function.
 * - Interface Segregation: Restricts worker interface strictly to repair operations.
 */

import { errorMessage, isOutOfMemory } from "@/lib/errors";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { RepairOutcome } from "../core/model";
import type { RepairOptions } from "../engine/repair-session";
import type { RepairRequest, RepairWorkerResult } from "../messages";

/** Abstract interface defining what the repair worker handler needs from the engine session. */
export interface RepairWorkerSession {
  /**
   * Executes repair on damaged PDF bytes.
   *
   * @param bytes Corrupted PDF input bytes.
   * @param options Password and normalization options.
   * @returns Detailed {@link RepairOutcome}.
   */
  repair(bytes: Uint8Array, options?: RepairOptions): Promise<RepairOutcome>;
}

/** Function type returning an initialized or cached session. */
export type SessionProvider = () => Promise<RepairWorkerSession>;

/**
 * Creates the request handler function for the repair worker.
 *
 * @param getSession Asynchronous factory providing the repair session.
 * @returns An async handler function processing {@link RepairRequest} messages.
 */
export function createRepairHandler(
  getSession: SessionProvider,
): (
  payload: RepairRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<RepairWorkerResult>> {
  return async (
    payload: RepairRequest,
    ctx: HandlerContext,
  ): Promise<HandlerResult<RepairWorkerResult>> => {
    if (payload.op === "ping") {
      return { result: { status: "pong" } };
    }

    if (payload.op !== "repair") {
      return {
        result: {
          status: "error",
          message: `Unknown operation: ${(payload as { op: string }).op}`,
        },
      };
    }

    try {
      ctx.progress(0.1, "Initializing repair engine");
      const session = await getSession();

      ctx.progress(0.3, "Analyzing and reconstructing document");
      const inputBytes = new Uint8Array(payload.data);
      const outcome = await session.repair(inputBytes, {
        password: payload.password,
      });

      ctx.progress(0.9, "Verifying document structure");

      if (outcome.kind === "repaired") {
        const buffer = toTransferableBuffer(outcome.pdf);
        return {
          result: {
            status: "repaired",
            data: buffer,
            pageCount: outcome.pageCount,
            report: outcome.report,
            warnings: outcome.warnings,
          },
          transfer: [buffer],
        };
      }

      if (outcome.kind === "password-required") {
        return {
          result: { status: "password-required" },
        };
      }

      if (outcome.kind === "failed") {
        return {
          result: {
            status: "unrecoverable",
            reason: outcome.message,
          },
        };
      }

      return {
        result: {
          status: "unrecoverable",
          reason: "Document could not be processed.",
        },
      };
    } catch (err: unknown) {
      if (isOutOfMemory(err)) {
        return {
          result: {
            status: "error",
            message:
              "The browser ran out of memory while repairing this PDF. Please try a smaller file.",
          },
        };
      }

      return {
        result: {
          status: "error",
          message: errorMessage(err) || "An unexpected error occurred during repair.",
        },
      };
    }
  };
}
