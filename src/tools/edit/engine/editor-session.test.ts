import { describe, expect, it } from "vitest";
import { fakeMetrics } from "../test-utils/fake-metrics";
import { fakePdfium } from "../test-utils/fake-pdfium";
import { EditorSession } from "./editor-session";

describe("EditorSession", () => {
  function setup() {
    const { api, runtime } = fakePdfium();
    api.FPDF_GetPageCount.mockReturnValue(2);
    return { api, runtime, session: new EditorSession(api, fakeMetrics) };
  }

  it("open reads every page and replaces a previously open file", () => {
    const { api, runtime, session } = setup();
    expect(session.open(new Uint8Array(2), "")).toHaveLength(2);
    session.open(new Uint8Array(2), "pw");
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(api.FPDF_LoadMemDocument).toHaveBeenLastCalledWith(
      expect.any(Number),
      2,
      "pw",
    );
    session.close();
    expect(runtime.leaks()).toEqual([]);
  });

  it("open refuses a file without pages and releases it", () => {
    const { api, runtime, session } = setup();
    api.FPDF_GetPageCount.mockReturnValue(0);
    expect(() => session.open(new Uint8Array(2), "")).toThrow("no pages");
    expect(session.isOpen()).toBe(false);
    expect(runtime.leaks()).toEqual([]);
  });

  it("render needs an open file (requireView)", () => {
    const { session } = setup();
    expect(() => session.render(0, 0, 100)).toThrow("No PDF is open");
  });

  it("textRuns reads a page's lines and needs a valid page (requirePage)", () => {
    const { api, runtime, session } = setup();
    expect(() => session.textRuns(0)).toThrow("No PDF is open");
    session.open(new Uint8Array(2), "");
    expect(session.textRuns(1)).toEqual([]); // the fake page has no objects
    expect(api.FPDFText_ClosePage).toHaveBeenCalledTimes(1);
    expect(() => session.textRuns(2)).toThrow("There is no page 3");
    session.close();
    expect(runtime.leaks()).toEqual([]);
  });

  it("render applies text edits only when there are some", () => {
    const { api, runtime, session } = setup();
    session.open(new Uint8Array(2), "");
    expect(session.render(0, 0, 10).textOutcomes).toEqual([]);
    expect(api.FPDFText_LoadPage).not.toHaveBeenCalled();
    // an edit for a line that does not exist is reported, not applied
    const { textOutcomes } = session.render(0, 0, 10, [
      { runId: "4", text: "x" },
      { runId: "bad id", text: "y" }, // dropped by sanitising
    ]);
    expect(textOutcomes).toEqual([
      {
        runId: "4",
        applied: false,
        failure: "line-not-found",
        written: "",
        substituteFont: null,
      },
    ]);
    expect(api.FPDFPage_GenerateContent).not.toHaveBeenCalled();
    expect(() => session.render(5, 0, 10)).toThrow("There is no page 6");
    session.close();
    expect(runtime.leaks()).toEqual([]);
  });

  it("save works on a fresh copy and always closes it", () => {
    const { api, runtime, session } = setup();
    session.open(new Uint8Array(2), "pw");
    api.PDFiumExt_SaveAsCopy.mockReturnValue(0);
    expect(() =>
      session.save({
        pages: [0, 1].map((i) => ({
          sourceIndex: i,
          rotation: 0,
          objects: [],
          textEdits: [],
        })),
        images: [],
      }),
    ).toThrow("could not save");
    // opened twice (view + copy), the copy already closed again
    expect(api.FPDF_LoadMemDocument).toHaveBeenCalledTimes(2);
    expect(api.FPDF_LoadMemDocument).toHaveBeenLastCalledWith(
      expect.any(Number),
      2,
      "pw",
    );
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    session.close();
    expect(runtime.leaks()).toEqual([]);
  });

  it("save needs an open file (requireView)", () => {
    const { session } = setup();
    expect(() => session.save({ pages: [], images: [] })).toThrow(
      "No PDF is open",
    );
  });

  it("close is safe to repeat", () => {
    const { session } = setup();
    session.close();
    session.close();
    expect(session.isOpen()).toBe(false);
  });
});
