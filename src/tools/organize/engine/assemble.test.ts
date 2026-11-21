import { describe, expect, it } from "vitest";
import { PdfiumDocument } from "@/tools/edit/engine/pdfium-document";
import { WasmHeap } from "@/tools/edit/engine/wasm-heap";
import {
  fakePdfium,
  type FakeRuntime,
  type MockedPdfium,
} from "@/tools/edit/test-utils/fake-pdfium";
import {
  appendBlankPage,
  assembleDocument,
  importBatch,
  reorderPages,
  rotatePages,
  type AssembleDeps,
} from "./assemble";

/**
 * A fake PDFium whose new document really counts its pages: imports and
 * blank pages add to the count, so the indices the assembler passes on can
 * be checked against what a real document would hold.
 */
function setup() {
  const { api, runtime } = fakePdfium();
  const heap = new WasmHeap(runtime);
  let pages = 0;
  api.FPDF_GetPageCount.mockImplementation(() => pages);
  api.FPDF_ImportPagesByIndex.mockImplementation(
    (_d, _s, _p, length) => ((pages += length), true),
  );
  api.FPDFPage_New.mockImplementation(() => (pages++, 900));
  const dest = PdfiumDocument.create(api, heap);
  const sourceA = PdfiumDocument.open(api, heap, new Uint8Array(1), "");
  const deps: AssembleDeps = {
    api,
    heap,
    source: (id) => {
      if (id !== "a") throw new Error("not open");
      return sourceA;
    },
  };
  return { api, runtime, heap, dest, sourceA, deps };
}

/** Read the int list PDFium received at `ptr` (the fake stores values by address). */
function intsAt(runtime: FakeRuntime, ptr: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => runtime.getValue(ptr + i * 4));
}

/** Allocations that are still live after the test (file blocks excluded). */
const leaks = (runtime: FakeRuntime, keep: number[]) =>
  runtime.leaks().filter((p) => !keep.includes(p));

describe("importBatch", () => {
  it("imports all of a batch's pages in one call, appended at the end", () => {
    const { api, runtime, dest, sourceA, deps } = setup();
    const filePtrs = [...runtime.allocated];
    importBatch(dest, { sourceId: "a", pageIndices: [2, 0, 5] }, deps);
    importBatch(dest, { sourceId: "a", pageIndices: [1] }, deps);
    const calls = api.FPDF_ImportPagesByIndex.mock.calls;
    expect(calls).toHaveLength(2);
    const [d, s, ptr, length, at] = calls[0];
    expect([d, s, length, at]).toEqual([dest.handle, sourceA.handle, 3, 0]);
    expect(intsAt(runtime, ptr, 3)).toEqual([2, 0, 5]);
    expect(calls[1][4]).toBe(3); // the second batch goes after the first
    expect(leaks(runtime, filePtrs)).toEqual([]);
  });

  it("throws (and frees the index list) when PDFium refuses", () => {
    const { api, runtime, dest, deps } = setup();
    const filePtrs = [...runtime.allocated];
    api.FPDF_ImportPagesByIndex.mockReturnValue(false);
    expect(() =>
      importBatch(dest, { sourceId: "a", pageIndices: [0] }, deps),
    ).toThrow("PDFium could not copy the pages of a file");
    expect(leaks(runtime, filePtrs)).toEqual([]);
  });

  it("throws for a file that is not open", () => {
    const { dest, deps } = setup();
    expect(() =>
      importBatch(dest, { sourceId: "zz", pageIndices: [0] }, deps),
    ).toThrow("not open");
  });
});

describe("appendBlankPage", () => {
  it("creates the page at the end with the given size and closes the handle", () => {
    const { api, dest } = setup();
    appendBlankPage(dest, { width: 612, height: 792 }, api);
    expect(api.FPDFPage_New).toHaveBeenCalledWith(dest.handle, 0, 612, 792);
    expect(api.FPDF_ClosePage).toHaveBeenCalledWith(900);
  });

  it("throws when PDFium cannot create the page", () => {
    const { api, dest } = setup();
    api.FPDFPage_New.mockReturnValue(0);
    expect(() => appendBlankPage(dest, { width: 1, height: 1 }, api)).toThrow(
      "PDFium could not add a blank page",
    );
    expect(api.FPDF_ClosePage).not.toHaveBeenCalled();
  });
});

describe("reorderPages", () => {
  /** A document that already holds `n` pages. */
  function withPages(api: MockedPdfium, n: number) {
    api.FPDF_GetPageCount.mockReturnValue(n);
  }

  it("moves every page into output order with one call", () => {
    const { api, runtime, dest, deps } = setup();
    withPages(api, 3);
    reorderPages(dest, [2, 0, 1], deps);
    const [doc, ptr, count, to] = api.FPDF_MovePages.mock.calls[0];
    expect([doc, count, to]).toEqual([dest.handle, 3, 0]);
    expect(intsAt(runtime, ptr, 3)).toEqual([2, 0, 1]);
  });

  it("does nothing when the pages are already in order", () => {
    const { api, dest, deps } = setup();
    withPages(api, 3);
    reorderPages(dest, [0, 1, 2], deps);
    expect(api.FPDF_MovePages).not.toHaveBeenCalled();
  });

  it("refuses an order that does not cover every page", () => {
    const { api, dest, deps } = setup();
    withPages(api, 3);
    expect(() => reorderPages(dest, [1, 0], deps)).toThrow(
      "does not cover every page",
    );
    expect(() => reorderPages(dest, [0, 0, 1], deps)).toThrow(
      "Invalid page order",
    );
  });

  it("throws when PDFium refuses the move", () => {
    const { api, dest, deps } = setup();
    withPages(api, 2);
    api.FPDF_MovePages.mockReturnValue(false);
    expect(() => reorderPages(dest, [1, 0], deps)).toThrow(
      "PDFium could not reorder the pages",
    );
  });
});

describe("rotatePages", () => {
  it("adds the turns to each page's own /Rotate, skipping unturned pages", () => {
    const { api, dest } = setup();
    api.FPDF_LoadPage.mockImplementation((_doc, index) => 500 + index);
    api.FPDFPage_GetRotation.mockImplementation((page) =>
      page === 502 ? 3 : 0,
    );
    rotatePages(dest, [1, 0, 2], api);
    expect(api.FPDF_LoadPage.mock.calls.map((c) => c[1])).toEqual([0, 2]);
    expect(api.FPDFPage_SetRotation.mock.calls).toEqual([
      [500, 1],
      [502, 1], // 3 + 2 wraps to 1
    ]);
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(2);
  });
});

describe("assembleDocument", () => {
  it("imports, appends blanks, reorders, then rotates by output position", () => {
    const { api, dest, deps } = setup();
    const log: string[] = [];
    api.FPDF_ImportPagesByIndex.mockImplementation((_d, _s, _p, length) => {
      log.push(`import ${length}`);
      api.FPDF_GetPageCount.mockReturnValue(length);
      return true;
    });
    api.FPDFPage_New.mockImplementation(() => {
      log.push("blank");
      api.FPDF_GetPageCount.mockReturnValue(3);
      return 900;
    });
    api.FPDF_MovePages.mockImplementation(() => (log.push("move"), true));
    api.FPDFPage_SetRotation.mockImplementation(() => log.push("rotate"));
    assembleDocument(
      dest,
      {
        batches: [{ sourceId: "a", pageIndices: [1, 0] }],
        blanks: [{ width: 10, height: 20 }],
        moveOrder: [2, 0, 1],
        rotations: [0, 1, 0],
      },
      deps,
    );
    expect(log).toEqual(["import 2", "blank", "move", "rotate"]);
    // The rotated page is output position 1, loaded after the move.
    expect(api.FPDF_LoadPage).toHaveBeenLastCalledWith(dest.handle, 1);
  });
});
