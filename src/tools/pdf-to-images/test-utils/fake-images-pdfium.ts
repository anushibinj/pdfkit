/**
 * Test doubles for this tool's slice of the PDFium module. Unit tests use
 * them to check call order and clean-up; real behaviour is covered by the
 * integration tests, which run the actual WebAssembly build.
 */
import {
  FakeRuntime,
  coreDefaults,
  handleCounter,
  mockApi,
  type MockedApi,
  type PdfiumFunctions,
} from "@/lib/pdfium/test-utils/fake-pdfium";
import type { ImagesPdfiumApi } from "../engine/pdfium-api";

/** Each PDFium function this tool calls as a typed `vi.fn` mock. */
export type MockedImagesPdfium = MockedApi<ImagesPdfiumApi>;

/**
 * A PDFium API whose functions are `vi.fn`s with harmless defaults: new
 * handles, `true`, empty pages, no clip path (-1), no filters, no data.
 * Override per test with `mockReturnValue` / `mockImplementation`.
 *
 * @param runtime The fake memory to use.
 * @returns The mocked API and its runtime.
 */
export function fakeImagesPdfium(runtime = new FakeRuntime()): {
  api: MockedImagesPdfium;
  runtime: FakeRuntime;
} {
  const nextHandle = handleCounter();
  const ok = () => true;
  const images: Omit<
    PdfiumFunctions<ImagesPdfiumApi>,
    keyof ReturnType<typeof coreDefaults>
  > = {
    FPDFPage_CountObjects: () => 0,
    FPDFPage_GetObject: () => 0,
    FPDFPageObj_GetType: () => 0,
    FPDFFormObj_CountObjects: () => 0,
    FPDFFormObj_GetObject: () => 0,
    FPDFImageObj_GetImagePixelSize: ok,
    FPDFImageObj_GetImageFilterCount: () => 0,
    FPDFImageObj_GetImageFilter: () => 0,
    FPDFImageObj_GetImageMetadata: ok,
    FPDFImageObj_GetIccProfileDataDecoded: () => false,
    FPDFImageObj_GetImageDataRaw: () => 0,
    FPDFImageObj_GetBitmap: nextHandle,
    FPDFImageObj_GetRenderedBitmap: nextHandle,
    FPDFBitmap_GetWidth: () => 0,
    FPDFBitmap_GetHeight: () => 0,
    FPDFBitmap_GetFormat: () => 4,
    FPDFPageObj_GetMatrix: ok,
    FPDFPageObj_SetMatrix: ok,
    FPDFPageObj_GetClipPath: nextHandle,
    FPDFClipPath_CountPaths: () => -1,
    FPDFPageObj_GetFillColor: () => false,
    FPDFPageObj_SetFillColor: ok,
  };
  const api = mockApi<ImagesPdfiumApi>(
    { ...coreDefaults(nextHandle), ...images },
    runtime,
  );
  return { api, runtime };
}
