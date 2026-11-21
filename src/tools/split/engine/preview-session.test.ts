import { describe, expect, it, vi } from "vitest";
import { FPDF_ERR } from "@/lib/pdfium/core-api";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import { fakePdfiumCore } from "@/lib/pdfium/test-utils/fake-pdfium";
import { PreviewSession, type PreviewPdfiumApi } from "./preview-session";

/**
 * The shared document fake plus a page-size function that writes the given
 * sizes (width, height floats) where PDFium would.
 */
function setup(sizes: [number, number][] = [[600, 400]]) {
  const { api, runtime } = fakePdfiumCore();
  api.FPDF_GetPageCount.mockReturnValue(sizes.length);
  const getSize = vi.fn((_doc: number, index: number, ptr: number) => {
    const size = sizes[index];
    if (!size) return false;
    runtime.setValue(ptr, size[0]);
    runtime.setValue(ptr + 4, size[1]);
    return true;
  });
  const preview: PreviewPdfiumApi = { ...api, FPDF_GetPageSizeByIndexF: getSize };
  return { api, runtime, getSize, session: new PreviewSession(preview) };
}

describe("PreviewSession", () => {
  it("open returns every page's size without loading pages", () => {
    const { api, session, getSize } = setup([
      [600, 400],
      [400, 600],
    ]);
    expect(session.open(new Uint8Array(3), "pw")).toEqual([
      { width: 600, height: 400 },
      { width: 400, height: 600 },
    ]);
    expect(api.FPDF_LoadMemDocument).toHaveBeenCalledWith(
      expect.any(Number),
      3,
      "pw",
    );
    expect(getSize).toHaveBeenCalledTimes(2);
    expect(api.FPDF_LoadPage).not.toHaveBeenCalled();
  });

  it("lays out unusable sizes as Letter", () => {
    const { session } = setup([[0, 0]]);
    expect(session.open(new Uint8Array(1), "")).toEqual([
      { width: 612, height: 792 },
    ]);
  });

  it("open passes password errors through and leaks nothing", () => {
    const { api, runtime, session } = setup();
    api.FPDF_LoadMemDocument.mockReturnValue(0);
    api.FPDF_GetLastError.mockReturnValue(FPDF_ERR.PASSWORD);
    expect(() => session.open(new Uint8Array(4), "")).toThrow(PdfOpenError);
    expect(runtime.leaks()).toEqual([]);
  });

  it("open closes the document when it has no pages or a size fails", () => {
    const empty = setup([]);
    expect(() => empty.session.open(new Uint8Array(1), "")).toThrow(
      "This PDF has no pages.",
    );
    expect(empty.api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(empty.runtime.leaks()).toEqual([]);

    const broken = setup([[600, 400]]);
    broken.getSize.mockReturnValue(false);
    expect(() => broken.session.open(new Uint8Array(1), "")).toThrow(
      "Could not read the size of page 1.",
    );
    expect(broken.api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(broken.runtime.leaks()).toEqual([]);
  });

  it("opening another file closes the first", () => {
    const { api, session } = setup();
    session.open(new Uint8Array(1), "");
    session.open(new Uint8Array(1), "");
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
  });

  it("render draws the page at the thumbnail size, with no extra rotation", () => {
    const { api, session } = setup([[600, 400]]);
    api.FPDFBitmap_GetStride.mockReturnValue(300 * 4);
    session.open(new Uint8Array(1), "");
    const page = session.render(0, 300);
    expect([page.width, page.height]).toEqual([300, 200]);
    expect(api.FPDF_RenderPageBitmap).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      0,
      0,
      300,
      200,
      0,
      expect.any(Number),
    );
  });

  it.each([1, -1, 0.5, Number.NaN, "length" as unknown as number])(
    "render refuses page %j of a one-page file",
    (index) => {
      const { session } = setup();
      session.open(new Uint8Array(1), "");
      expect(() => session.render(index, 100)).toThrow(/There is no page/);
    },
  );

  it("render and close need an open file; close is safe twice", () => {
    const { api, runtime, session } = setup();
    expect(() => session.render(0, 100)).toThrow("No PDF is open.");
    session.open(new Uint8Array(1), "");
    session.close();
    session.close();
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(() => session.render(0, 100)).toThrow("No PDF is open.");
    expect(runtime.leaks()).toEqual([]);
  });
});
