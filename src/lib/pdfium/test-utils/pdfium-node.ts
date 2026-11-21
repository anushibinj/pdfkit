/**
 * Test-only helper that runs the real PDFium WebAssembly build in Node.
 * Node only (reads the binary with fs).
 */
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Instantiate PDFium from the npm package's binary, the same build the
 * browser downloads from /wasm/.
 *
 * @returns The initialised module (callers narrow it to their interface).
 */
export async function loadNodePdfiumModule(): Promise<WrappedPdfiumModule> {
  const require = createRequire(import.meta.url);
  const wasmBinary = readFileSync(
    require.resolve("@embedpdf/pdfium/pdfium.wasm"),
  );
  const full = await init({ wasmBinary } as never);
  full.PDFiumExt_Init();
  return full;
}
