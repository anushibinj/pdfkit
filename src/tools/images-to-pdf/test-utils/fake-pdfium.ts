/**
 * Lightweight test doubles for {@link ImagesToPdfPdfiumApi} built on top of
 * the shared PDFium core fake.
 */
import {
  FakeRuntime,
  coreDefaults,
  handleCounter,
  mockApi,
  type MockedApi,
  type PdfiumFunctions,
} from "@/lib/pdfium/test-utils/fake-pdfium";
import type { ImagesToPdfPdfiumApi } from "../engine/pdfium-api";

/** Every method of {@link ImagesToPdfPdfiumApi} wrapped in a typed `vi.fn`. */
export type MockedImagesToPdfPdfium = MockedApi<ImagesToPdfPdfiumApi>;

/**
 * Create a mocked {@link ImagesToPdfPdfiumApi} where every PDFium call
 * succeeds cleanly (handles increment from 101, images decode to `100 x 80`).
 *
 * @param runtime Optional fake WASM linear memory runtime.
 * @returns The mocked API and its backing runtime.
 */
export function fakeImagesToPdfPdfium(runtime = new FakeRuntime()): {
  api: MockedImagesToPdfPdfium;
  runtime: FakeRuntime;
} {
  const nextHandle = handleCounter();
  const ok = () => true;
  const none = () => {};
  const defaults: PdfiumFunctions<ImagesToPdfPdfiumApi> = {
    ...coreDefaults(nextHandle),
    FPDFPage_GenerateContent: ok,
    FPDFPage_InsertObject: none,
    FPDFPageObj_Transform: none,
    FPDFPageObj_Destroy: none,
    FPDFPageObj_NewImageObj: nextHandle,
    EPDFImageObj_SetPng: ok,
    EPDFImageObj_SetJpeg: ok,
    FPDFImageObj_GetImagePixelSize: (_image, widthPtr, heightPtr) => {
      runtime.setValue(widthPtr, 100);
      runtime.setValue(heightPtr, 80);
      return true;
    },
  };
  return { api: mockApi(defaults, runtime), runtime };
}
