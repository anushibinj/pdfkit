import { describe, expect, it, vi } from "vitest";
import { FPDF_ERR } from "@/lib/pdfium/core-api";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import { InvalidCropPlanError } from "../core/crop-plan";
import { fakeCropPdfium } from "../test-utils/fake-crop-pdfium";
import { CropSession, EncryptedPdfError } from "./crop-session";
import type { PdfCropModule } from "./pdf-crop-module";

const noModule = vi.fn(async (): Promise<PdfCropModule> => {
  throw new Error("not needed");
});

function setup() {
  const { api, runtime } = fakeCropPdfium();
  return { api, runtime, session: new CropSession(api, noModule) };
}

describe("CropSession.open", () => {
  it("returns every page's box and rotation", () => {
    const { api, session } = setup();
    api.FPDF_GetPageCount.mockReturnValue(2);
    expect(session.open(Uint8Array.of(1))).toHaveLength(2);
  });

  it("refuses files with a security handler and closes them again", () => {
    const { api, session } = setup();
    api.FPDF_GetSecurityHandlerRevision.mockReturnValue(4);
    expect(() => session.open(Uint8Array.of(1))).toThrow(EncryptedPdfError);
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
  });

  it("turns a password error into EncryptedPdfError, other errors pass", () => {
    const { api, session } = setup();
    api.FPDF_LoadMemDocument.mockReturnValue(0);
    api.FPDF_GetLastError.mockReturnValue(FPDF_ERR.PASSWORD);
    expect(() => session.open(Uint8Array.of(1))).toThrow(EncryptedPdfError);
    api.FPDF_GetLastError.mockReturnValue(FPDF_ERR.FORMAT);
    expect(() => session.open(Uint8Array.of(1))).toThrow(PdfOpenError);
  });

  it("refuses documents without pages", () => {
    const { api, session } = setup();
    api.FPDF_GetPageCount.mockReturnValue(0);
    expect(() => session.open(Uint8Array.of(1))).toThrow("no pages");
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
  });
});

describe("CropSession.render", () => {
  it("needs an open document and an existing page", () => {
    const { session } = setup();
    expect(() => session.render(0, 100)).toThrow("No PDF is open");
    session.open(Uint8Array.of(1));
    expect(() => session.render(3, 100)).toThrow("There is no page 4");
  });
});

describe("CropSession.crop", () => {
  it("needs an open document and a valid plan, before loading the module", async () => {
    const { session } = setup();
    await expect(session.crop({ pages: [] })).rejects.toThrow("No PDF is open");
    session.open(Uint8Array.of(1));
    await expect(session.crop({ pages: [] })).rejects.toThrow(
      InvalidCropPlanError,
    );
    expect(noModule).not.toHaveBeenCalled();
  });
});

describe("CropSession.close", () => {
  it("closes the document once and can be called again", () => {
    const { api, session } = setup();
    session.open(Uint8Array.of(1));
    session.close();
    session.close();
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
  });
});
