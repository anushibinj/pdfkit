import { describe, expect, it } from "vitest";
import { InvalidPlanError } from "@/tools/edit/core/sanitize-plan";
import { FPDF_ERR } from "@/tools/edit/engine/pdfium-api";
import { PdfOpenError } from "@/tools/edit/engine/pdfium-document";
import { fakePdfium } from "@/tools/edit/test-utils/fake-pdfium";
import { OrganizeSession } from "./organize-session";

/**
 * A session over a fake PDFium where every opened file has `pageCount`
 * pages of 200 x 100 points, and saving yields the bytes [1, 2, 3].
 */
function setup(pageCount = 2) {
  const { api, runtime } = fakePdfium();
  api.FPDF_GetPageCount.mockReturnValue(pageCount);
  // FS_RECTF: left, top, right, bottom.
  api.FPDF_GetPageBoundingBox.mockImplementation((_page, rect) => {
    [0, 100, 200, 0].forEach((v, i) => runtime.setValue(rect + i * 4, v));
    return true;
  });
  api.PDFiumExt_GetFileWriterSize.mockReturnValue(3);
  api.PDFiumExt_GetFileWriterData.mockImplementation((_w, ptr) => {
    runtime.HEAPU8.set([1, 2, 3], ptr);
    return 3;
  });
  return { api, runtime, session: new OrganizeSession(api) };
}
const bytes = () => new Uint8Array([37, 80, 68, 70]);

describe("OrganizeSession.open", () => {
  it("opens several files at once and reports their pages", () => {
    const { session } = setup();
    const pages = session.open("a", bytes(), "");
    session.open("b", bytes(), "pw");
    expect(pages).toEqual([
      { box: { left: 0, bottom: 0, right: 200, top: 100 }, rotation: 0 },
      { box: { left: 0, bottom: 0, right: 200, top: 100 }, rotation: 0 },
    ]);
    expect(session.openIds()).toEqual(["a", "b"]);
  });

  it("replaces a file opened again under the same id", () => {
    const { api, session } = setup();
    session.open("a", bytes(), "");
    session.open("a", bytes(), "pw");
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(session.openIds()).toEqual(["a"]);
  });

  it("rejects invalid ids before touching PDFium", () => {
    const { api, session } = setup();
    expect(() => session.open("", bytes(), "")).toThrow("Invalid file id.");
    expect(() => session.open(7, bytes(), "")).toThrow("Invalid file id.");
    expect(api.FPDF_LoadMemDocument).not.toHaveBeenCalled();
  });

  it("closes (and frees) a file without pages", () => {
    const { api, runtime, session } = setup(0);
    expect(() => session.open("a", bytes(), "")).toThrow("no pages");
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(runtime.leaks()).toEqual([]);
    expect(session.openIds()).toEqual([]);
  });

  it("passes PDFium's refusal on as a PdfOpenError", () => {
    const { api, session } = setup();
    api.FPDF_LoadMemDocument.mockReturnValue(0);
    api.FPDF_GetLastError.mockReturnValue(FPDF_ERR.PASSWORD);
    expect(() => session.open("a", bytes(), "")).toThrow(PdfOpenError);
  });
});

describe("OrganizeSession.render", () => {
  it("renders at the turned page's shape", () => {
    const { api, session } = setup();
    session.open("a", bytes(), "");
    const page = session.render("a", 1, 1, 100);
    // 200 x 100 turned a quarter: 100 wide, 200 tall.
    expect([page.width, page.height]).toEqual([100, 200]);
    expect(api.FPDF_RenderPageBitmap).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      0,
      0,
      100,
      200,
      1,
      expect.any(Number),
    );
  });

  it("refuses unknown files and pages", () => {
    const { session } = setup();
    session.open("a", bytes(), "");
    expect(() => session.render("b", 0, 0, 100)).toThrow("not open");
    expect(() => session.render("a", 2, 0, 100)).toThrow("There is no page 3.");
  });
});

describe("OrganizeSession.save", () => {
  it("builds a new document from the open files and closes it", () => {
    const { api, session } = setup();
    session.open("a", bytes(), "");
    session.open("b", bytes(), "");
    let pages = 0;
    const docs = new Set<number>();
    api.FPDF_CreateNewDocument.mockImplementation(() => 777);
    api.FPDF_GetPageCount.mockImplementation((doc) => {
      docs.add(doc);
      return doc === 777 ? pages : 2;
    });
    api.FPDF_ImportPagesByIndex.mockImplementation(
      (_d, _s, _p, length) => ((pages += length), true),
    );
    const out = session.save([
      { kind: "source", sourceId: "b", pageIndex: 1, rotation: 0 },
      { kind: "source", sourceId: "a", pageIndex: 0, rotation: 0 },
    ]);
    expect([...out]).toEqual([1, 2, 3]);
    expect(api.FPDF_ImportPagesByIndex).toHaveBeenCalledTimes(2);
    expect(api.PDFiumExt_SaveAsCopy).toHaveBeenCalledWith(
      777,
      expect.any(Number),
    );
    expect(api.FPDF_CloseDocument).toHaveBeenCalledWith(777);
  });

  it("rejects a plan that refers to a file that is not open", () => {
    const { api, session } = setup();
    session.open("a", bytes(), "");
    expect(() =>
      session.save([
        { kind: "source", sourceId: "b", pageIndex: 0, rotation: 0 },
      ]),
    ).toThrow(InvalidPlanError);
    expect(api.FPDF_CreateNewDocument).not.toHaveBeenCalled();
  });

  it("closes the new document when building fails", () => {
    const { api, session } = setup();
    session.open("a", bytes(), "");
    api.FPDF_CreateNewDocument.mockReturnValue(777);
    api.FPDF_ImportPagesByIndex.mockReturnValue(false);
    expect(() =>
      session.save([
        { kind: "source", sourceId: "a", pageIndex: 0, rotation: 0 },
      ]),
    ).toThrow("PDFium could not copy");
    expect(api.FPDF_CloseDocument).toHaveBeenCalledWith(777);
  });
});

describe("OrganizeSession.close", () => {
  it("closes one file, ignores unknown ids, or closes all", () => {
    const { api, runtime, session } = setup();
    session.open("a", bytes(), "");
    session.open("b", bytes(), "");
    session.open("c", bytes(), "");
    session.close("b");
    session.close("b");
    session.close(42);
    expect(session.openIds()).toEqual(["a", "c"]);
    session.close();
    expect(session.openIds()).toEqual([]);
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(3);
    expect(runtime.leaks()).toEqual([]);
  });
});
