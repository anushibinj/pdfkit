// @vitest-environment node
/**
 * Runs the real PDFium WebAssembly build end to end: the board is arranged
 * with the real reducer, turned into the plan the UI sends, saved by the
 * worker's session, and the result is read back with PDFium (text, page
 * size, /Rotate, object types) and pdf-lib (object structure).
 *
 * These pin the acceptance criteria of the "Organize pages" issue:
 * interleaving two files, rotation without rasterising, the 10-page duplex
 * fixture, and undo (covered by the reducer tests).
 */
import { readFileSync } from "node:fs";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  StandardFonts,
} from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import type { PageInfo } from "@/tools/edit/core/model";
import { InvalidPlanError } from "@/tools/edit/core/sanitize-plan";
import type { PdfiumApi } from "@/tools/edit/engine/pdfium-api";
import { PAGE_OBJECT_TEXT } from "@/tools/edit/engine/pdfium-api";
import { PdfOpenError } from "@/tools/edit/engine/pdfium-document";
import {
  extractText,
  loadNodePdfium,
  type FullPdfium,
} from "@/tools/edit/test-utils/pdfium-node";
import type { BoardSource } from "../core/board";
import {
  EMPTY_BOARD_STATE,
  boardReducer,
  type BoardAction,
  type BoardState,
} from "../core/board-state";
import { buildOutputPlan } from "../core/output-plan";
import { OrganizeSession } from "./organize-session";

let api: PdfiumApi;
let full: FullPdfium;
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../../../fixtures/${name}`, import.meta.url)),
  );

beforeAll(async () => {
  ({ api, full } = await loadNodePdfium());
});

/**
 * A PDF whose pages each show one label as real text ("Page 3").
 *
 * @param labels One label per page.
 * @param size Page size in points (default US Letter portrait).
 * @returns The file's bytes.
 */
async function labelledPdf(
  labels: (string | number)[],
  size: [number, number] = [612, 792],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of labels) {
    doc
      .addPage(size)
      .drawText(`Page ${label}`, { x: 72, y: size[1] - 144, size: 36, font });
  }
  return doc.save();
}

/** The label of each page of a PDF, read back with PDFium's text extraction. */
function pageLabels(bytes: Uint8Array, password = ""): string[] {
  return extractText(full, bytes, password).map((t) => t.trim());
}

/**
 * Open files in a fresh session and register them with the reducer, the
 * way the UI does: the session reports the pages, the reducer gets them.
 */
function openBoard(
  files: { id: string; bytes: Uint8Array; password?: string }[],
): { session: OrganizeSession; state: BoardState } {
  const session = new OrganizeSession(api);
  let state = EMPTY_BOARD_STATE;
  files.forEach(({ id, bytes, password = "" }, colorIndex) => {
    const pages: PageInfo[] = session.open(id, bytes, password);
    const source: BoardSource = {
      id,
      name: `${id}.pdf`,
      pages,
      colorIndex,
      passwordProtected: password !== "",
    };
    state = boardReducer(state, { type: "add-source", source });
  });
  return { session, state };
}

/** Apply actions, then save the board through the session. */
function saveAfter(
  session: OrganizeSession,
  state: BoardState,
  ...actions: BoardAction[]
): Uint8Array {
  const final = actions.reduce(boardReducer, state);
  return session.save(buildOutputPlan(final.history.present));
}

/** Select the board pages at the given positions. */
function selectAt(state: BoardState, ...indices: number[]): BoardState {
  return indices.reduce(
    (s, index, n) =>
      boardReducer(s, {
        type: "select",
        key: s.history.present[index].key,
        mode: n === 0 ? "only" : "toggle",
      }),
    state,
  );
}

/**
 * Inspect one page of a PDF with PDFium: its /Rotate, visible size and the
 * types of its page objects.
 */
function inspectPage(bytes: Uint8Array, index: number) {
  const { pdfium } = full;
  const ptr = pdfium.wasmExports.malloc(bytes.length);
  pdfium.HEAPU8.set(bytes, ptr);
  const doc = full.FPDF_LoadMemDocument(ptr, bytes.length, "");
  if (!doc) throw new Error(`load failed: ${full.FPDF_GetLastError()}`);
  const page = full.FPDF_LoadPage(doc, index);
  const rect = pdfium.wasmExports.malloc(16);
  full.FPDF_GetPageBoundingBox(page, rect);
  const [left, top, right, bottom] = [0, 1, 2, 3].map((i) =>
    Number(pdfium.getValue(rect + i * 4, "float")),
  );
  const types = Array.from(
    { length: full.FPDFPage_CountObjects(page) },
    (_, i) => full.FPDFPageObj_GetType(full.FPDFPage_GetObject(page, i)),
  );
  const result = {
    rotation: full.FPDFPage_GetRotation(page),
    width: Math.round(right - left),
    height: Math.round(top - bottom),
    types,
    encrypted: full.FPDF_GetSecurityHandlerRevision(doc) !== -1,
  };
  pdfium.wasmExports.free(rect);
  full.FPDF_ClosePage(page);
  full.FPDF_CloseDocument(doc);
  pdfium.wasmExports.free(ptr);
  return result;
}

describe("OrganizeSession with real PDFium", () => {
  it("restores a 10-page duplex scan (fronts, then reversed backs)", async () => {
    const scan = await labelledPdf([1, 3, 5, 7, 9, 10, 8, 6, 4, 2]);
    const { session, state } = openBoard([{ id: "scan", bytes: scan }]);
    const out = saveAfter(session, state, { type: "interleave" });
    expect(pageLabels(out)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `Page ${n}`),
    );
  });

  it("restores the committed duplex fixtures, as one file and as two", () => {
    const pages1to10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const one = openBoard([{ id: "scan", bytes: fixture("duplex-scan.pdf") }]);
    const fromOne = saveAfter(one.session, one.state, { type: "interleave" });
    expect(
      pageLabels(fromOne).map((t) => t.split(/\s+/).slice(0, 2).join(" ")),
    ).toEqual(pages1to10.map((n) => `Page ${n}`));
    const two = openBoard([
      { id: "fronts", bytes: fixture("duplex-fronts.pdf") },
      { id: "backs", bytes: fixture("duplex-backs.pdf") },
    ]);
    const fromTwo = saveAfter(two.session, two.state, { type: "interleave" });
    expect(
      pageLabels(fromTwo).map((t) => t.split(/\s+/).slice(0, 2).join(" ")),
    ).toEqual(pages1to10.map((n) => `Page ${n}`));
  });

  it("interleaves pages from two files into one PDF", async () => {
    const fronts = await labelledPdf([1, 3, 5]);
    const backs = await labelledPdf([6, 4, 2]);
    const { session, state } = openBoard([
      { id: "fronts", bytes: fronts },
      { id: "backs", bytes: backs },
    ]);
    const out = saveAfter(session, state, { type: "interleave" });
    expect(pageLabels(out)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Page ${n}`));
  });

  it("rotates by /Rotate only: no rasterising, text stays text", async () => {
    const bytes = await labelledPdf(["A", "B"]);
    const { session, state } = openBoard([{ id: "a", bytes }]);
    const out = saveAfter(session, selectAt(state, 0), {
      type: "rotate",
      delta: 1,
    });
    const page = inspectPage(out, 0);
    expect(page.rotation).toBe(1);
    expect(page.types.length).toBeGreaterThan(0);
    expect(page.types.every((t) => t === PAGE_OBJECT_TEXT)).toBe(true);
    expect(pageLabels(out)).toEqual(["Page A", "Page B"]);
    expect(inspectPage(out, 1).rotation).toBe(0);
  });

  it("turns landscape pages upright and keeps a page's own /Rotate", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([800, 600]); // landscape
    doc.addPage([600, 800]); // portrait
    const { session, state } = openBoard([
      { id: "a", bytes: await doc.save() },
    ]);
    const out = saveAfter(session, state, { type: "turn-landscape" });
    expect([
      inspectPage(out, 0).rotation,
      inspectPage(out, 1).rotation,
    ]).toEqual([1, 0]);
  });

  it("inserts a blank page sized like its neighbour, and deletes and duplicates", async () => {
    const a = await labelledPdf(["A1", "A2"], [500, 300]);
    const b = await labelledPdf(["B1"]);
    const { session, state } = openBoard([
      { id: "a", bytes: a },
      { id: "b", bytes: b },
    ]);
    let s = boardReducer(selectAt(state, 0), { type: "insert-blank" });
    s = boardReducer(selectAt(s, 2), { type: "delete" }); // A2
    s = boardReducer(selectAt(s, 2), { type: "duplicate" }); // B1
    const out = session.save(buildOutputPlan(s.history.present));
    expect(pageLabels(out)).toEqual(["Page A1", "", "Page B1", "Page B1"]);
    const blank = inspectPage(out, 1);
    expect([blank.width, blank.height]).toEqual([500, 300]);
    expect(blank.types).toEqual([]);
  });

  it("gives each copy of a duplicated page its own annotations", async () => {
    // signed.pdf has one widget annotation on its page.
    const { session, state } = openBoard([
      { id: "s", bytes: fixture("signed.pdf") },
    ]);
    const out = saveAfter(session, selectAt(state, 0), { type: "duplicate" });
    const doc = await PDFDocument.load(out);
    const annots = doc.getPages().map((page) => {
      const list = page.node.lookup(PDFName.of("Annots"), PDFArray);
      const ref = list.get(0) as PDFRef;
      const annot = doc.context.lookup(ref, PDFDict);
      return {
        ref: ref.toString(),
        parent: annot.get(PDFName.of("P"))?.toString(),
        page: page.ref.toString(),
      };
    });
    expect(annots).toHaveLength(2);
    expect(annots[0].ref).not.toBe(annots[1].ref);
    for (const a of annots) expect(a.parent).toBe(a.page);
  });

  it("opens a password-protected file with its password; the output has none", async () => {
    const session = new OrganizeSession(api);
    expect(() => session.open("p", fixture("user-password.pdf"), "")).toThrow(
      PdfOpenError,
    );
    const { session: s2, state } = openBoard([
      { id: "p", bytes: fixture("user-password.pdf"), password: "hunter2" },
      { id: "o", bytes: fixture("owner-restricted.pdf") },
    ]);
    const out = saveAfter(s2, state);
    expect(inspectPage(out, 0).encrypted).toBe(false);
    expect(pageLabels(out)).toEqual([
      "pdfkit test document",
      "pdfkit test document",
    ]);
  });

  it("keeps embedded subset fonts working when pages are re-ordered", () => {
    const { session, state } = openBoard([
      { id: "c", bytes: fixture("text-chromium.pdf") },
      { id: "p", bytes: fixture("plain.pdf") },
    ]);
    const out = saveAfter(session, state, { type: "reverse" });
    const [first, second] = extractText(full, out);
    expect(first).toContain("pdfkit test document");
    expect(second).toContain("Total amount due is 1250 dollars.");
  });

  it("renders thumbnails of any open file, turned", async () => {
    const { session } = openBoard([
      { id: "a", bytes: await labelledPdf(["A"]) },
      { id: "b", bytes: await labelledPdf(["B"], [400, 200]) },
    ]);
    const thumb = session.render("b", 0, 1, 100);
    expect([thumb.width, thumb.height]).toEqual([100, 200]);
    // Some pixel is not white: the label was drawn.
    const dark = thumb.pixels.some((v, i) => i % 4 !== 3 && v < 128);
    expect(dark).toBe(true);
  });

  it("saving twice gives the same pages (sources are never modified)", async () => {
    const { session, state } = openBoard([
      { id: "a", bytes: await labelledPdf([1, 2, 3]) },
    ]);
    const plan = buildOutputPlan(
      boardReducer(state, { type: "reverse" }).history.present,
    );
    expect(pageLabels(session.save(plan))).toEqual(
      pageLabels(session.save(plan)),
    );
    expect(session.render("a", 0, 0, 50).width).toBe(50);
  });

  it("rejects a plan for a file that was closed", async () => {
    const { session, state } = openBoard([
      { id: "a", bytes: await labelledPdf([1]) },
    ]);
    session.close("a");
    expect(() => session.save(buildOutputPlan(state.history.present))).toThrow(
      InvalidPlanError,
    );
  });

  it("handles a 500-page file", async () => {
    const labels = Array.from({ length: 500 }, (_, i) => i + 1);
    const { session, state } = openBoard([
      { id: "big", bytes: await labelledPdf(labels) },
    ]);
    expect(state.history.present).toHaveLength(500);
    const out = saveAfter(session, state, { type: "reverse" });
    const text = pageLabels(out);
    expect(text).toHaveLength(500);
    expect([text[0], text[499]]).toEqual(["Page 500", "Page 1"]);
  });
});
