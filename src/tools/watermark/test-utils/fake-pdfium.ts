/**
 * Test doubles for the watermark tool's PDFium interface: the shared core
 * fake plus the drawing functions. Unit tests use them to check call order
 * and clean-up; real behaviour is covered by the integration tests.
 */
import {
  FakeRuntime,
  coreDefaults,
  handleCounter,
  mockApi,
  type MockedApi,
  type PdfiumFunctions,
} from "@/lib/pdfium/test-utils/fake-pdfium";
import type { WatermarkPdfiumApi } from "../engine/watermark-pdfium-api";

/** Each watermark PDFium function as a typed `vi.fn` mock. */
export type MockedWatermarkPdfium = MockedApi<WatermarkPdfiumApi>;

/**
 * A watermark PDFium API where every function succeeds harmlessly
 * (handles 101, 102, ...; booleans true; no TrimBox; pictures decode
 * to 1 x 1).
 *
 * @param runtime The fake memory to use.
 * @returns The mocked API and its runtime.
 */
export function fakeWatermarkPdfium(runtime = new FakeRuntime()): {
  api: MockedWatermarkPdfium;
  runtime: FakeRuntime;
} {
  const nextHandle = handleCounter();
  const ok = () => true;
  const none = () => {};
  const defaults: PdfiumFunctions<WatermarkPdfiumApi> = {
    ...coreDefaults(nextHandle),
    FPDFPage_GenerateContent: ok,
    FPDFPage_InsertObject: none,
    FPDFPage_GetTrimBox: () => false,
    FPDFPageObj_NewTextObj: nextHandle,
    FPDFText_SetText: ok,
    FPDFPageObj_NewImageObj: nextHandle,
    EPDFImageObj_SetPng: ok,
    EPDFImageObj_SetJpeg: ok,
    // A decoded 1 x 1 picture, so pictures load unless a test says otherwise.
    FPDFImageObj_GetImagePixelSize: (_image, widthPtr, heightPtr) => {
      runtime.setValue(widthPtr, 1);
      runtime.setValue(heightPtr, 1);
      return true;
    },
    FPDFPageObj_SetFillColor: ok,
    FPDFPageObj_GetBounds: ok,
    FPDFPageObj_Transform: none,
    FPDFPageObj_AddMark: nextHandle,
    FPDFPageObj_Destroy: none,
    FPDF_NewXObjectFromPage: nextHandle,
    FPDF_NewFormObjectFromXObject: nextHandle,
    FPDF_CloseXObject: none,
  };
  return { api: mockApi(defaults, runtime), runtime };
}
