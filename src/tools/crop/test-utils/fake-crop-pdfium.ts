/**
 * Test doubles for the crop tool's PDFium API: the shared core fakes plus
 * the functions the crop tool adds.
 */
import {
  FakeRuntime,
  coreDefaults,
  handleCounter,
  mockApi,
  type MockedApi,
  type PdfiumFunctions,
} from "@/lib/pdfium/test-utils/fake-pdfium";
import type { CropPdfiumApi } from "../engine/crop-pdfium-api";

/** Each function of the crop API as a typed `vi.fn` mock. */
export type MockedCropPdfium = MockedApi<CropPdfiumApi>;

/**
 * A crop PDFium API where every function is a `vi.fn` returning a harmless
 * value: documents are not encrypted (revision -1), text pages are empty.
 *
 * @param runtime The fake memory to use.
 * @returns The mocked API and its runtime.
 */
export function fakeCropPdfium(runtime = new FakeRuntime()): {
  api: MockedCropPdfium;
  runtime: FakeRuntime;
} {
  const nextHandle = handleCounter();
  const defaults: PdfiumFunctions<CropPdfiumApi> = {
    ...coreDefaults(nextHandle),
    FPDF_GetSecurityHandlerRevision: () => -1,
    FPDFPage_SetCropBox: () => {},
    FPDFText_LoadPage: nextHandle,
    FPDFText_ClosePage: () => {},
    FPDFText_CountChars: () => 0,
    FPDFText_GetUnicode: () => 0,
    FPDFText_IsGenerated: () => 0,
    FPDFText_GetCharBox: () => true,
    FPDFText_GetCharOrigin: () => true,
  };
  return { api: mockApi<CropPdfiumApi>(defaults, runtime), runtime };
}
