import { errorMessage, isOutOfMemory } from "@/lib/errors";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { ConvertRequest, ConvertResult } from "../messages";

/** Anything that turns a request into PDF bytes (the real one is `MarkdownToPdfConverter`). */
export interface Converter {
  convert(request: ConvertRequest): Uint8Array;
}

/**
 * Return an `ArrayBuffer` holding exactly the bytes of `bytes`.
 *
 * `postMessage` transfers whole `ArrayBuffer`s, not views. If the view covers
 * its entire buffer, that buffer is handed over as-is (no copy). If it is a
 * window into a bigger buffer (for example a slice of WebAssembly memory),
 * transferring the whole buffer would send unrelated bytes and detach memory
 * the engine still needs, so the window is copied into a new buffer first.
 *
 * @param bytes A byte view.
 * @returns A buffer that can be safely transferred.
 */
export function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  const whole =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  return whole
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);
}

/**
 * Turn a thrown value into a typed error result.
 *
 * - Memory exhaustion gets its own reason and an actionable message.
 * - A `WebAssembly.RuntimeError` is a trap ("unreachable", a Rust panic, an
 *   out-of-bounds access). After a trap the instance's state is undefined, and
 *   the wasm-bindgen glue keeps returning that same instance, so the only real
 *   recovery is a fresh worker. The "crashed" reason tells the UI to restart it.
 * - Everything else (for example a parse error reported by the engine) is a
 *   normal failure; the worker stays usable.
 *
 * @param err The thrown value.
 * @returns An error {@link ConvertResult}.
 */
export function toErrorResult(
  err: unknown,
): Extract<ConvertResult, { status: "error" }> {
  if (isOutOfMemory(err)) {
    return {
      status: "error",
      reason: "out-of-memory",
      message:
        "The browser ran out of memory while creating the PDF. Try a shorter document, or close other tabs.",
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
 * Build the function the worker exposes with `exposeWorker`.
 *
 * Flow for one request:
 * 1. Report a little progress so the UI can show that work has started.
 * 2. Get the converter. On the first request this downloads and compiles the
 *    WebAssembly engine, which can fail (offline, blocked); that failure is
 *    reported as "Could not load the PDF engine" instead of a raw error.
 * 3. Convert, then transfer the PDF's buffer back without copying it.
 * Every failure becomes a typed result, so the promise never rejects and the
 * UI only has to handle one shape.
 *
 * @param getConverter Resolves to a ready converter (memoised by the caller).
 * @returns The request handler.
 */
export function createConvertHandler(
  getConverter: () => Promise<Converter>,
): (
  request: ConvertRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<ConvertResult>> {
  return async (request, ctx) => {
    ctx.progress(0.1, "Loading the PDF engine");
    let converter: Converter;
    try {
      converter = await getConverter();
    } catch (err) {
      return {
        result: {
          status: "error",
          reason: "failed",
          message: `Could not load the PDF engine: ${errorMessage(err)}`,
        },
      };
    }
    ctx.progress(0.3, "Laying out pages");
    try {
      const data = toTransferableBuffer(converter.convert(request));
      return { result: { status: "converted", data }, transfer: [data] };
    } catch (err) {
      return { result: toErrorResult(err) };
    }
  };
}
