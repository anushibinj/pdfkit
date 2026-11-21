// @vitest-environment node
/**
 * Runs the real qpdf WebAssembly build (from node_modules) to pin down the
 * behaviour Merge PDFs relies on. If a qpdf upgrade changes any of it, these
 * tests fail before users notice.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import {
  loadNodeQpdf,
  readFixture,
  type NodeQpdf,
} from "@/lib/qpdf/test-utils/qpdf-node";
import type { MergeOutcome } from "./pdf-merger";
import { QpdfMerger } from "./qpdf-merger";

let node: NodeQpdf;
let qpdf: QpdfRunner;
let merger: QpdfMerger;

beforeAll(async () => {
  node = await loadNodeQpdf();
  qpdf = node.runner;
  merger = new QpdfMerger(qpdf);
}, 60_000);
afterAll(() => node?.restoreConsole());

/** A PDF with one blank page per size, so page order is visible in the output. */
async function pdfWithPages(...sizes: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const size of sizes) doc.addPage(size);
  return doc.save();
}

/**
 * A hand-written one-page PDF whose annotation's /Contents is `literal`,
 * exactly as written (pdf-lib would re-encode it).
 */
function pdfWithAnnotationContents(literal: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>",
    `<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents ${literal} >>`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function merged(outcome: MergeOutcome): Uint8Array {
  if (outcome.status !== "merged") throw new Error(outcome.message);
  return outcome.bytes;
}

async function pageSizes(bytes: Uint8Array): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return [Math.round(width), Math.round(height)];
  });
}

describe("QpdfMerger.inspect with the real qpdf build", () => {
  it("counts pages", async () => {
    const bytes = await pdfWithPages([100, 100], [200, 200], [300, 300]);
    expect(merger.inspect({ bytes })).toEqual({
      status: "inspected",
      pageCount: 3,
    });
  });

  it("opens owner-restricted files without a password", () => {
    expect(
      merger.inspect({ bytes: readFixture("owner-restricted.pdf") }),
    ).toEqual({ status: "inspected", pageCount: 1 });
  });

  it("asks for, rejects and accepts a user password", () => {
    const bytes = readFixture("user-password.pdf");
    expect(merger.inspect({ bytes })).toEqual({ status: "password-required" });
    expect(merger.inspect({ bytes, password: "nope" })).toEqual({
      status: "wrong-password",
    });
    expect(merger.inspect({ bytes, password: "hunter2" })).toEqual({
      status: "inspected",
      pageCount: 1,
    });
  });

  it("explains a file that is not a PDF", () => {
    expect(
      merger.inspect({ bytes: new TextEncoder().encode("hello") }),
    ).toEqual({
      status: "error",
      reason: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
  });

  it("refuses a PDF with no pages", async () => {
    // pdf-lib adds a blank page to an empty document unless told not to.
    const empty = await (
      await PDFDocument.create()
    ).save({ addDefaultPage: false });
    expect(merger.inspect({ bytes: empty })).toMatchObject({
      status: "error",
      message: "This PDF has no pages.",
    });
  });
});

describe("QpdfMerger.merge with the real qpdf build", () => {
  it("keeps every page of every file, in the given order", async () => {
    const a = await pdfWithPages([100, 100], [110, 110]);
    const b = await pdfWithPages([200, 200]);
    const c = await pdfWithPages([300, 300], [310, 310], [320, 320]);
    const out = merged(
      merger.merge([{ bytes: c }, { bytes: a }, { bytes: b }]),
    );
    expect(await pageSizes(out)).toEqual([
      [300, 300],
      [310, 310],
      [320, 320],
      [100, 100],
      [110, 110],
      [200, 200],
    ]);
  });

  it("can use the same file twice", async () => {
    const a = await pdfWithPages([100, 100]);
    const out = merged(merger.merge([{ bytes: a }, { bytes: a }]));
    expect(await pageSizes(out)).toEqual([
      [100, 100],
      [100, 100],
    ]);
  });

  it("decrypts password-protected inputs and writes an unencrypted file", async () => {
    const out = merged(
      merger.merge([
        { bytes: readFixture("plain.pdf") },
        { bytes: readFixture("user-password.pdf"), password: "hunter2" },
        { bytes: readFixture("owner-restricted.pdf") },
      ]),
    );
    expect((await pageSizes(out)).length).toBe(3);
    const encryption = qpdf.withJob((job) =>
      qpdf.run(["--show-encryption", job.write("check.pdf", out)]),
    );
    expect(encryption.stdout).toMatch(/not encrypted/);
  });

  it("keeps the form fields of the merged pages", async () => {
    const formDoc = await PDFDocument.create();
    const page = formDoc.addPage([300, 300]);
    const field = formDoc.getForm().createTextField("applicant.name");
    field.setText("Ada");
    field.addToPage(page, { x: 20, y: 20, width: 200, height: 30 });
    const withForm = await formDoc.save();
    const plain = await pdfWithPages([100, 100]);

    const out = merged(merger.merge([{ bytes: plain }, { bytes: withForm }]));
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField("applicant.name").getText()).toBe("Ada");
  });

  it("does not drop characters after short octal escapes in strings", async () => {
    // qpdf 11.0.0 to 11.6.2 could drop the character after a 1- or
    // 2-digit octal escape such as \1 (fixed in 11.6.3). Merging rewrites
    // every non-content string, so check the shipped build keeps them.
    const source = pdfWithAnnotationContents("(A\\1BC\\12DE\\0011)");
    const out = merged(merger.merge([{ bytes: source }]));
    const doc = await PDFDocument.load(out);
    const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const contents = annots.lookup(0, PDFDict).lookup(PDFName.of("Contents"));
    if (
      !(contents instanceof PDFString) &&
      !(contents instanceof PDFHexString)
    ) {
      throw new Error("annotation lost its /Contents");
    }
    expect(Array.from(contents.asBytes())).toEqual([
      0x41, 1, 0x42, 0x43, 10, 0x44, 0x45, 1, 0x31,
    ]);
  });

  it("names the source that cannot be read", async () => {
    const good = await pdfWithPages([100, 100]);
    const outcome = merger.merge([
      { bytes: good },
      { bytes: good },
      { bytes: new TextEncoder().encode("not a pdf") },
    ]);
    expect(outcome).toEqual({
      status: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
      sourceIndex: 2,
    });
  });

  it("names the source whose password is wrong", () => {
    const outcome = merger.merge([
      { bytes: readFixture("plain.pdf") },
      { bytes: readFixture("user-password.pdf"), password: "nope" },
    ]);
    expect(outcome).toEqual({
      status: "failed",
      message: "The password for this file is wrong.",
      sourceIndex: 1,
    });
  });

  it("needs the explicit page range this qpdf build requires", () => {
    // Documents why mergeArgs never omits the range: without it, this
    // build fails even though the manual says the range is optional.
    const res = qpdf.withJob((job) => {
      const a = job.write("a.pdf", readFixture("plain.pdf"));
      const b = job.write("b.pdf", readFixture("plain.pdf"));
      return qpdf.run(["--empty", "--pages", a, b, "--", job.path("o.pdf")]);
    });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/unexpected character/);
  });
});
