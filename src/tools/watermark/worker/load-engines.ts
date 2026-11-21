import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { ModuleImporter } from "@/lib/module-importer";
import { loadPdfiumModule } from "@/lib/pdfium/load-pdfium";
import type { CapturableConsole } from "@/lib/qpdf/console-capture";
import type { WasmInstantiator } from "@/lib/qpdf/instantiate-wasm";
import { loadQpdf } from "@/lib/qpdf/load-qpdf";
import type { QpdfEngine } from "@/lib/qpdf/qpdf-runner";
import { createPainterRegistry } from "../engine/painters/registry";
import type { WatermarkPdfiumApi } from "../engine/watermark-pdfium-api";
import { WatermarkSession } from "../engine/watermark-session";

/**
 * Narrow the full PDFium module to the watermark tool's interface.
 *
 * An identity function at runtime. Its value is at compile time: if the
 * library's real signatures ever stop matching `WatermarkPdfiumApi` (after
 * an upgrade, say), TypeScript fails here instead of the tool failing in a
 * user's browser.
 *
 * @param pdfium The initialised module.
 * @returns The same module, typed as {@link WatermarkPdfiumApi}.
 */
export function asWatermarkPdfiumApi(
  pdfium: WrappedPdfiumModule,
): WatermarkPdfiumApi {
  return pdfium;
}

/** How to load the two engines (injected for tests). */
export interface EngineLoaders {
  pdfium(): Promise<WrappedPdfiumModule>;
  qpdf(): Promise<QpdfEngine>;
}

/**
 * The real loaders: both engines come from `wasmDir` on our own origin.
 *
 * @param wasmDir Absolute URL of the directory, ending in "/".
 * @param importer Performs dynamic imports of the glue files.
 * @param instantiate Instantiates qpdf's binary.
 * @param console The worker's console, captured for qpdf's messages.
 * @returns The loaders.
 */
export function engineLoaders(
  wasmDir: string,
  importer: ModuleImporter,
  instantiate: WasmInstantiator,
  console: CapturableConsole,
): EngineLoaders {
  return {
    pdfium: () => loadPdfiumModule(wasmDir, importer),
    qpdf: () => loadQpdf(wasmDir, { importer, instantiate, console }),
  };
}

/**
 * Load PDFium and qpdf (in parallel: they are independent) and build the
 * session with the real painters.
 *
 * @param loaders How to load each engine.
 * @returns A ready session.
 */
export async function loadWatermarkSession(
  loaders: EngineLoaders,
): Promise<WatermarkSession> {
  const [pdfium, qpdf] = await Promise.all([loaders.pdfium(), loaders.qpdf()]);
  return new WatermarkSession(
    asWatermarkPdfiumApi(pdfium),
    qpdf,
    createPainterRegistry(),
  );
}
