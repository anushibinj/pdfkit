import { errorMessage } from "@/lib/errors";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import { crc32 } from "@/lib/crc32";
import { InvalidRequestError, validateOutputs } from "../core/validate-request";
import {
  AssemblyError,
  WrongPasswordError,
  type Assembly,
  type AssemblyProgress,
} from "../engine/page-assembler";
import type { AssembleRequest, AssembleResult, AssembledFile } from "../messages";
import { toErrorResult } from "./error-result";

/** What the handler needs from the worker's assembler (`PageAssembler`). */
export interface AssemblerLike {
  assemble(
    source: Uint8Array,
    password: string,
    pageCount: number,
    outputs: readonly (readonly number[])[],
    onProgress?: AssemblyProgress,
  ): Assembly;
}

/** Share of the progress bar used before the first file is made. */
const SETUP_PROGRESS = 0.05;

/**
 * Build the function the assembly worker exposes with `exposeWorker`.
 *
 * Flow for one request:
 * 1. Report a little progress so the UI shows work has started.
 * 2. Get the assembler. The first request loads qpdf, which can fail
 *    (offline, blocked): "Could not load the PDF engine".
 * 3. Check the request (it crossed a thread boundary): file bytes, page
 *    count and every output's pages.
 * 4. Build the files, reporting progress per file.
 * 5. Compute each file's CRC-32 here, while its bytes are at hand, so the
 *    UI can build a ZIP without reading them again, then transfer the
 *    buffers back without copying.
 *
 * Every failure becomes a typed result, so the promise never rejects. A
 * crash or memory exhaustion also calls `onEngineFailure`, so the caller
 * can drop the qpdf instance (its memory is no longer trustworthy) and load
 * a fresh one for the next request.
 *
 * @param getAssembler Resolves to the assembler (memoised by the caller).
 * @param onEngineFailure Called after a crash or out-of-memory error.
 * @returns The request handler.
 */
export function createAssembleHandler(
  getAssembler: () => Promise<AssemblerLike>,
  onEngineFailure: () => void = () => {},
): (
  request: AssembleRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<AssembleResult>> {
  return async (request, ctx) => {
    ctx.progress(0.01, "Loading the PDF engine");
    let assembler: AssemblerLike;
    try {
      assembler = await getAssembler();
    } catch (err) {
      return {
        result: {
          status: "error",
          reason: "failed",
          message: `Could not load the PDF engine: ${errorMessage(err)}`,
        },
      };
    }
    try {
      if (!(request.data instanceof ArrayBuffer)) {
        throw new InvalidRequestError("No file was received.");
      }
      const { pageCount, outputs } = validateOutputs(
        request.pageCount,
        request.outputs,
      );
      const password =
        typeof request.password === "string" ? request.password : "";
      ctx.progress(SETUP_PROGRESS, "Making the files");
      const { files, warnings } = assembler.assemble(
        new Uint8Array(request.data),
        password,
        pageCount,
        outputs,
        (done, total) =>
          ctx.progress(
            SETUP_PROGRESS + (1 - SETUP_PROGRESS) * (done / total),
            `Made ${done} of ${total}`,
          ),
      );
      const assembled: AssembledFile[] = files.map((bytes) => ({
        data: toTransferableBuffer(bytes),
        crc32: crc32(bytes),
      }));
      return {
        result: {
          status: "assembled",
          files: assembled,
          warnings: warnings.length > 0 ? warnings.join(" ") : undefined,
        },
        transfer: assembled.map((f) => f.data),
      };
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        return { result: { status: "wrong-password" } };
      }
      if (err instanceof AssemblyError || err instanceof InvalidRequestError) {
        return {
          result: { status: "error", reason: "failed", message: err.message },
        };
      }
      const result = toErrorResult(err, "making the files");
      if (result.reason !== "failed") onEngineFailure();
      return { result };
    }
  };
}
