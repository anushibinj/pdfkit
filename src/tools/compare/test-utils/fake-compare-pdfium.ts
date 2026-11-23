/**
 * Test doubles for the Compare PDFs PDFium API.
 */
import {
  FakeRuntime,
  coreDefaults,
  handleCounter,
  mockApi,
  type MockedApi,
  type PdfiumFunctions,
} from "@/lib/pdfium/test-utils/fake-pdfium";
import type { ComparePdfiumApi } from "../engine/pdfium-api";

/** Typed `vi.fn` mock for every method of {@link ComparePdfiumApi}. */
export type MockedComparePdfium = MockedApi<ComparePdfiumApi>;

/**
 * Write an array of IEEE-754 float64 values into `runtime.HEAPU8` at `ptr`
 * (little-endian).
 *
 * @param runtime Fake runtime memory.
 * @param ptr Target address.
 * @param values Float64 values to write.
 */
export function writeDoublesToHeap(
  runtime: FakeRuntime,
  ptr: number,
  values: readonly number[],
): void {
  values.forEach((v, idx) => runtime.setValue(ptr + idx * 8, v));
}

/**
 * Write an array of IEEE-754 float32 values into `FakeRuntime`'s value map
 * at `ptr`, matching `WasmHeap.readFloats`.
 *
 * @param runtime Fake runtime memory.
 * @param ptr Target address.
 * @param values Float32 values to write.
 */
export function writeFloatsToHeap(
  runtime: FakeRuntime,
  ptr: number,
  values: readonly number[],
): void {
  values.forEach((v, idx) => runtime.setValue(ptr + idx * 4, v));
}

/**
 * Create a mocked {@link ComparePdfiumApi} backed by {@link FakeRuntime}.
 *
 * @param runtime Optional fake Emscripten runtime.
 * @returns Mocked PDFium API and runtime instance.
 */
export function fakeComparePdfium(runtime = new FakeRuntime()): {
  api: MockedComparePdfium;
  runtime: FakeRuntime;
} {
  const nextHandle = handleCounter();
  const defaults: PdfiumFunctions<ComparePdfiumApi> = {
    ...coreDefaults(nextHandle),
    FPDF_GetPageBoundingBox: (_page, rectPtr) => {
      writeFloatsToHeap(runtime, rectPtr, [0, 792, 612, 0]);
      return true;
    },
    FPDFText_LoadPage: nextHandle,
    FPDFText_ClosePage: () => {},
    FPDFText_CountChars: () => 0,
    FPDFText_GetUnicode: () => 0,
    FPDFText_IsGenerated: () => 0,
    FPDFText_GetCharBox: () => true,
    FPDF_ImportPagesByIndex: () => true,
    FPDFPage_CreateAnnot: nextHandle,
    FPDFPage_CloseAnnot: () => {},
    FPDFAnnot_SetColor: () => true,
    FPDFAnnot_SetRect: () => true,
    FPDFAnnot_AppendAttachmentPoints: () => true,
    FPDFAnnot_SetStringValue: () => true,
    FPDFAnnot_SetFlags: () => true,
    FPDFAnnot_SetBorder: () => true,
    EPDFAnnot_GenerateAppearance: () => true,
    FPDFPageObj_NewTextObj: nextHandle,
    FPDFText_SetText: () => true,
    FPDFPageObj_SetFillColor: () => true,
    FPDFPageObj_Transform: () => {},
    FPDFPageObj_Destroy: () => {},
    FPDFPage_InsertObject: () => {},
    FPDFPage_GenerateContent: () => true,
  };
  return { api: mockApi<ComparePdfiumApi>(defaults, runtime), runtime };
}
