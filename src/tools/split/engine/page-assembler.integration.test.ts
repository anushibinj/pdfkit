// @vitest-environment node
/**
 * Runs the real qpdf WebAssembly build: the files the assembler makes are
 * opened again (with pdf-lib and qpdf) to check what they contain, not just
 * that qpdf exited with 0.
 */
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import { loadNodeQpdf, readFixture } from "@/lib/qpdf/test-utils/node-qpdf";
import { planEvery } from "../core/output-plan";
import { AssemblyError, PageAssembler, WrongPasswordError } from "./page-assembler";

let qpdf: QpdfRunner;
let assembler: PageAssembler;
/** 40 pages; page n is (200 + n) points wide and says "PAGE-n-MARK". */
let source: Uint8Array;
const PAGES = 40;

const mark = (n: number) => `PAGE-${n}-MARK`;

/** Page widths of a PDF, which identify our fixture's pages (200 + n). */
async function pageNumbers(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((p) => p.getWidth() - 200);
}

/** Every decoded stream of a PDF as Latin-1 text (to look for page marks). */
async function allStreamText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let text = "";
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      text += Buffer.from(decodePDFRawStream(object).decode()).toString("latin1");
    }
  }
  return text;
}

/** pdf-lib writes standard-font text as hex strings: look for both forms. */
const containsMark = (text: string, n: number) =>
  text.includes(mark(n)) ||
  text.toUpperCase().includes(Buffer.from(mark(n)).toString("hex").toUpperCase());

beforeAll(async () => {
  qpdf = await loadNodeQpdf();
  assembler = new PageAssembler(qpdf);
  const doc = await PDFDocument.create();
  doc.setTitle("Assembler fixture");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  for (let n = 1; n <= PAGES; n++) {
    const page = doc.addPage([200 + n, 300]);
    page.drawText(mark(n), { x: 10, y: 150, size: 10, font });
    if (n === 2 || n === 7) {
      const field = form.createTextField(`field${n}`);
      field.setText(`value ${n}`);
      field.addToPage(page, { x: 10, y: 200, width: 150, height: 20 });
    }
  }
  source = await doc.save();
}, 60_000);

describe("PageAssembler with the real qpdf", () => {
  it("extracts pages, keeping the title and only their form fields", async () => {
    const { files, warnings } = assembler.assemble(source, "", PAGES, [[1, 6]]);
    expect(warnings).toEqual([]);
    expect(await pageNumbers(files[0])).toEqual([2, 7]);
    const doc = await PDFDocument.load(files[0], { updateMetadata: false });
    expect(doc.getTitle()).toBe("Assembler fixture");
    expect(
      doc.getForm().getFields().map((f) => f.getName()).sort(),
    ).toEqual(["field2", "field7"]);
  });

  it("leaves no content of the other pages in the file", async () => {
    const { files } = assembler.assemble(source, "", PAGES, [[2, 3]]);
    const text = await allStreamText(files[0]);
    expect(containsMark(text, 3)).toBe(true);
    expect(containsMark(text, 4)).toBe(true);
    for (const n of [1, 2, 5, 40]) expect(containsMark(text, n)).toBe(false);
    // and the form field of page 2 is gone with its page
    const doc = await PDFDocument.load(files[0], { updateMetadata: false });
    expect(doc.getForm().getFields()).toEqual([]);
    expect(doc.catalog.get(PDFName.of("Pages"))).toBeDefined();
  });

  it("splits into single pages through parts, identical to direct runs", async () => {
    const plan = planEvery(PAGES, 1);
    if (!plan.ok) throw new Error(plan.error);
    const outputs = plan.outputs.map((o) => o.pages);
    const progress: number[] = [];
    const batched = assembler.assemble(source, "", PAGES, outputs, (done) =>
      progress.push(done),
    );
    expect(progress).toEqual(Array.from({ length: PAGES }, (_, i) => i + 1));
    for (let i = 0; i < PAGES; i++) {
      expect(await pageNumbers(batched.files[i])).toEqual([i + 1]);
    }
    // the same output made directly (fewer than 8 outputs: no parts)
    const direct = assembler.assemble(source, "", PAGES, [[6]]);
    const viaPart = await PDFDocument.load(batched.files[6], { updateMetadata: false });
    const straight = await PDFDocument.load(direct.files[0], { updateMetadata: false });
    expect(viaPart.getTitle()).toBe(straight.getTitle());
    expect(viaPart.getForm().getFields().map((f) => f.getName())).toEqual(["field7"]);
  });

  it("keeps the password of an encrypted file", () => {
    const encrypted = readFixture("user-password.pdf");
    const { files } = assembler.assemble(encrypted, "hunter2", 1, [[0]]);
    qpdf.writeFile("/check.pdf", files[0]);
    try {
      expect(qpdf.run(["--check", "/check.pdf"]).stderr).toMatch(/invalid password/);
      expect(qpdf.run(["--password=hunter2", "--check", "/check.pdf"]).code).toBe(0);
    } finally {
      qpdf.remove("/check.pdf");
    }
  });

  it("refuses a wrong password", () => {
    expect(() =>
      assembler.assemble(readFixture("user-password.pdf"), "nope", 1, [[0]]),
    ).toThrow(WrongPasswordError);
  });

  it("reports a file qpdf cannot read in plain words", () => {
    expect(() =>
      assembler.assemble(new TextEncoder().encode("not a pdf"), "", 1, [[0]]),
    ).toThrow(
      new AssemblyError("This does not look like a valid PDF file, or it is damaged."),
    );
  });
});
