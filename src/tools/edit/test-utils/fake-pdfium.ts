/**
 * Test doubles for the editor's slice of the PDFium module. Unit tests use
 * them to check call order and clean-up; real behaviour is covered by the
 * integration tests, which run the actual WebAssembly build.
 */
import { FakeRuntime } from "@/lib/pdfium/test-utils/fake-runtime";
import {
  documentDefaults,
  handleCounter,
  mockFunctions,
  saveDefaults,
  type ApiFunctions,
  type MockedApi,
} from "@/lib/pdfium/test-utils/fake-api";
import type { PdfiumApi } from "../engine/pdfium-api";

/** Each PDFium function the editor calls as a typed `vi.fn` mock. */
export type MockedPdfium = MockedApi<PdfiumApi>;

/**
 * A PDFium API where every function is a `vi.fn` returning a harmless
 * success value (handles are 101, 102, ...; booleans true). Override per
 * test with `mockReturnValue` / `mockImplementation`; the mocks carry the
 * real signatures, so implementations are type-checked.
 *
 * @param runtime The fake memory to use.
 * @returns The mocked API and its runtime.
 */
export function fakePdfium(runtime = new FakeRuntime()): {
  api: MockedPdfium;
  runtime: FakeRuntime;
} {
  const nextHandle = handleCounter();
  const ok = () => true;
  const none = () => {};
  const editing: Omit<
    ApiFunctions<PdfiumApi>,
    | keyof ReturnType<typeof documentDefaults>
    | keyof ReturnType<typeof saveDefaults>
  > = {
    FPDF_MovePages: ok,
    FPDFPage_SetRotation: none,
    FPDFPage_GenerateContent: ok,
    FPDFPage_InsertObject: none,
    FPDFPage_InsertObjectAtIndex: ok,
    FPDFPage_RemoveObject: ok,
    FPDFPage_CountObjects: () => 0,
    FPDFPage_GetObject: () => 0,
    FPDFPage_Delete: none,
    FPDFPageObj_NewTextObj: nextHandle,
    FPDFPageObj_CreateTextObj: nextHandle,
    FPDFText_SetText: ok,
    FPDFPageObj_CreateNewPath: nextHandle,
    FPDFPageObj_CreateNewRect: nextHandle,
    FPDFPath_LineTo: ok,
    FPDFPath_SetDrawMode: ok,
    FPDFPageObj_NewImageObj: nextHandle,
    EPDFImageObj_SetPng: ok,
    EPDFImageObj_SetJpeg: ok,
    FPDFPageObj_SetFillColor: ok,
    FPDFPageObj_SetStrokeColor: ok,
    FPDFPageObj_SetStrokeWidth: ok,
    FPDFPageObj_SetLineCap: ok,
    FPDFPageObj_SetLineJoin: ok,
    FPDFPageObj_SetBlendMode: none,
    FPDFPageObj_Transform: none,
    FPDFPageObj_Destroy: none,
    FPDFPageObj_GetType: () => 0,
    FPDFPageObj_GetMatrix: ok,
    FPDFPageObj_SetMatrix: ok,
    FPDFPageObj_GetBounds: ok,
    FPDFPageObj_GetFillColor: ok,
    FPDFPageObj_GetStrokeColor: ok,
    FPDFPageObj_GetStrokeWidth: ok,
    FPDFTextObj_GetText: () => 0,
    FPDFTextObj_GetFont: nextHandle,
    FPDFTextObj_GetFontSize: ok,
    FPDFTextObj_GetTextRenderMode: () => 0,
    FPDFTextObj_SetTextRenderMode: ok,
    FPDFFont_GetBaseFontName: () => 0,
    FPDFFont_GetFamilyName: () => 0,
    FPDFFont_GetFlags: () => 0,
    FPDFFont_GetWeight: () => 400,
    FPDFFont_GetItalicAngle: ok,
    FPDFFont_GetIsEmbedded: () => 0,
    FPDFText_LoadPage: nextHandle,
    FPDFText_ClosePage: none,
    FPDFText_CountChars: () => 0,
    FPDFText_GetUnicode: () => 0,
    FPDFText_IsGenerated: () => 0,
    FPDFText_GetTextObject: () => 0,
    FPDFText_GetCharOrigin: ok,
  };
  const mocks = mockFunctions<ApiFunctions<PdfiumApi>>({
    ...documentDefaults(nextHandle),
    ...saveDefaults(nextHandle),
    ...editing,
  });
  return { api: { ...mocks, pdfium: runtime }, runtime };
}
