/**
 * Test doubles for the organizer's PDFium interface: the shared core fake
 * plus the page-tree functions. Unit tests use them to check call order
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
import type { OrganizePdfiumApi } from "../engine/organize-pdfium-api";

/** Each organizer PDFium function as a typed `vi.fn` mock. */
export type MockedOrganizePdfium = MockedApi<OrganizePdfiumApi>;

/**
 * An organizer PDFium API where every function succeeds harmlessly
 * (handles 101, 102, ...; booleans true; one page per document).
 *
 * @param runtime The fake memory to use.
 * @returns The mocked API and its runtime.
 */
export function fakeOrganizePdfium(runtime = new FakeRuntime()): {
  api: MockedOrganizePdfium;
  runtime: FakeRuntime;
} {
  const nextHandle = handleCounter();
  const defaults: PdfiumFunctions<OrganizePdfiumApi> = {
    ...coreDefaults(nextHandle),
    FPDF_ImportPagesByIndex: () => true,
    FPDF_MovePages: () => true,
    FPDFPage_SetRotation: () => {},
  };
  return { api: mockApi(defaults, runtime), runtime };
}
