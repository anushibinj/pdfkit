import { errorMessage, isOutOfMemory } from "@/lib/errors";
import { isQuarterTurns, type QuarterTurns } from "@/lib/pdfium/page-box";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import { InvalidImageError } from "../engine/image-embedder";
import type { ImageSource, PdfFromImagesEngine } from "../engine/pdf-builder";
import type {
  BuildPdfRequest,
  BuildPdfResult,
  ImagePageInput,
} from "../messages";

/**
 * Classify a thrown error into a structured {@link BuildPdfResult} error.
 *
 * - {@link InvalidImageError} preserves the exact failing `imageIndex` so the
 *   UI can tell the user which file could not be decoded.
 * - Memory exhaustion (`RangeError` or known Emscripten OOM messages) gets an
 *   actionable `"out-of-memory"` reason.
 * - A `WebAssembly.RuntimeError` indicates a WASM trap leaving heap state
 *   undefined, so it is tagged `"crashed"` to trigger worker restart.
 * - Everything else maps to `"failed"`.
 *
 * @param err Any thrown value.
 * @returns Structured error response.
 */
export function toErrorResult(
  err: unknown,
): Extract<BuildPdfResult, { status: "error" }> {
  if (err instanceof InvalidImageError) {
    return {
      status: "error",
      reason: "invalid-image",
      message: err.message,
      imageIndex: err.imageIndex,
    };
  }
  if (isOutOfMemory(err)) {
    return {
      status: "error",
      reason: "out-of-memory",
      message:
        "The browser ran out of memory while creating the PDF. Close other tabs or try fewer/smaller images.",
    };
  }
  if (
    typeof WebAssembly !== "undefined" &&
    err instanceof WebAssembly.RuntimeError
  ) {
    return {
      status: "error",
      reason: "crashed",
      message: `The PDF engine stopped unexpectedly (${err.message}). Please try again.`,
    };
  }
  return {
    status: "error",
    reason: "failed",
    message: errorMessage(err),
  };
}

/**
 * Sanitise a wire {@link ImagePageInput} into an engine {@link ImageSource}.
 *
 * Defensively validates rotation so an out-of-range message value defaults to
 * `0` rather than breaking the affine matrix switch.
 *
 * @param input Untrusted wire payload for one image.
 * @returns Validated {@link ImageSource}.
 */
export function toImageSource(input: ImagePageInput): ImageSource {
  const rotation: QuarterTurns = isQuarterTurns(input.rotation)
    ? input.rotation
    : 0;
  return {
    bytes: new Uint8Array(input.data),
    mime: input.mime,
    width: input.width,
    height: input.height,
    rotation,
  };
}

/**
 * Execute one {@link BuildPdfRequest} against the engine and prepare a
 * zero-copy transferable response.
 *
 * @param engine Ready PDF builder engine.
 * @param request Incoming build request.
 * @param ctx Worker progress reporting context.
 * @returns Serialised PDF result with transferable `ArrayBuffer`, or a typed
 *   error result.
 */
export function handleBuildRequest(
  engine: PdfFromImagesEngine,
  request: BuildPdfRequest,
  ctx: HandlerContext,
): HandlerResult<BuildPdfResult> {
  try {
    const sources = Array.isArray(request.images)
      ? request.images.map(toImageSource)
      : [];
    const built = engine.build(sources, request.options, (progress, stage) =>
      ctx.progress(progress, stage),
    );
    const data = toTransferableBuffer(built.bytes);
    return {
      result: { status: "done", data, pageCount: built.pageCount },
      transfer: [data],
    };
  } catch (err) {
    return { result: toErrorResult(err) };
  }
}

/**
 * Create the async worker handler wired into `exposeWorker`.
 *
 * Lazily resolves the engine via `getEngine` so PDFium WASM is only downloaded
 * and compiled when the user actually triggers their first conversion.
 *
 * @param getEngine Async factory returning the shared {@link PdfFromImagesEngine}.
 * @returns Handler compatible with `exposeWorker`.
 */
export function createImagesToPdfHandler(
  getEngine: () => Promise<PdfFromImagesEngine>,
): (
  payload: BuildPdfRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<BuildPdfResult>> {
  return async (payload, ctx) => {
    try {
      const engine = await getEngine();
      return handleBuildRequest(engine, payload, ctx);
    } catch (err) {
      return { result: toErrorResult(err) };
    }
  };
}
