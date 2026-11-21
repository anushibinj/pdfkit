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
import { beforeAll, describe, expect, it } from "vitest";
import { probeEncryption } from "@/lib/qpdf/encryption-status";
import { runQpdfJob } from "@/lib/qpdf/qpdf-job";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import { loadNodeQpdf, readFixture } from "@/lib/qpdf/test-utils/node-qpdf";
import {
  PdfMerger,
  WRONG_PASSWORD_MESSAGE,
  type MergeOutcome,
} from "./pdf-merger";

let qpdf: QpdfRunner;
let merger: PdfMerger;

beforeAll(async () => {
  qpdf = await loadNodeQpdf();
  merger = new PdfMerger(qpdf);
}, 60_000);

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

/**
 * Encrypt a PDF with qpdf so that `password` opens it.
 *
 * @param pdf The PDF to encrypt.
 * @param password Any password, however it looks.
 * @returns The encrypted PDF.
 */
function encrypt(pdf: Uint8Array, password: string): Uint8Array {
  const [input, output, job] = ["/enc-in.pdf", "/enc-out.pdf", "/enc.json"];
  qpdf.writeFile(input, pdf);
  try {
    runQpdfJob(qpdf, job, {
      inputFile: input,
      outputFile: output,
      encrypt: {
        userPassword: password,
        ownerPassword: password,
        "256bit": {},
      },
    });
    return qpdf.readFile(output).slice();
  } finally {
    qpdf.remove(input);
    qpdf.remove(output);
  }
}

function merged(outcome: MergeOutcome): Uint8Array {
  if (outcome.kind !== "merged") throw new Error(outcome.message);
  return outcome.pdf;
}

async function pageSizes(bytes: Uint8Array): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return [Math.round(width), Math.round(height)];
  });
}

describe("PdfMerger.inspect with the real qpdf build", () => {
  it("counts pages", async () => {
    const bytes = await pdfWithPages([100, 100], [200, 200], [300, 300]);
    expect(merger.inspect(bytes)).toEqual({ kind: "inspected", pageCount: 3 });
  });

  it("opens owner-restricted files without a password", () => {
    expect(merger.inspect(readFixture("owner-restricted.pdf"))).toEqual({
      kind: "inspected",
      pageCount: 1,
    });
  });

  it("asks for, rejects and accepts a user password", () => {
    const bytes = readFixture("user-password.pdf");
    expect(merger.inspect(bytes)).toEqual({ kind: "password-required" });
    expect(merger.inspect(bytes, "nope")).toEqual({ kind: "wrong-password" });
    expect(merger.inspect(bytes, "hunter2")).toEqual({
      kind: "inspected",
      pageCount: 1,
    });
  });

  it("accepts passwords that would break a command line", async () => {
    const password = '@--1-z "pw"';
    const locked = encrypt(await pdfWithPages([100, 100]), password);
    expect(merger.inspect(locked, password)).toEqual({
      kind: "inspected",
      pageCount: 1,
    });
  });

  it("explains a file that is not a PDF", () => {
    expect(merger.inspect(new TextEncoder().encode("hello"))).toEqual({
      kind: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
  });

  it("refuses a PDF with no pages", async () => {
    // pdf-lib adds a blank page to an empty document unless told not to.
    const empty = await (
      await PDFDocument.create()
    ).save({ addDefaultPage: false });
    expect(merger.inspect(empty)).toEqual({
      kind: "failed",
      message: "This PDF has no pages.",
    });
  });
});

describe("PdfMerger.merge with the real qpdf build", () => {
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

  it("decrypts protected inputs and writes an unencrypted file", async () => {
    const password = '@--1-z "pw"';
    const out = merged(
      merger.merge([
        { bytes: readFixture("plain.pdf") },
        { bytes: readFixture("user-password.pdf"), password: "hunter2" },
        { bytes: readFixture("owner-restricted.pdf") },
        { bytes: encrypt(await pdfWithPages([50, 50]), password), password },
      ]),
    );
    expect((await pageSizes(out)).length).toBe(4);
    qpdf.writeFile("/merged-check.pdf", out);
    try {
      expect(probeEncryption(qpdf, "/merged-check.pdf")).toEqual({
        kind: "not-encrypted",
      });
    } finally {
      qpdf.remove("/merged-check.pdf");
    }
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
    expect(
      merger.merge([
        { bytes: good },
        { bytes: good },
        { bytes: new TextEncoder().encode("not a pdf") },
      ]),
    ).toEqual({
      kind: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
      sourceIndex: 2,
    });
  });

  it("names the source whose password is wrong", () => {
    expect(
      merger.merge([
        { bytes: readFixture("plain.pdf") },
        { bytes: readFixture("user-password.pdf"), password: "nope" },
      ]),
    ).toEqual({
      kind: "failed",
      message: WRONG_PASSWORD_MESSAGE,
      sourceIndex: 1,
    });
  });

  it("needs the explicit page range on this build's command line", () => {
    // Documents why ALL_PAGES is always spelled out: without a range, this
    // build's command line fails although the manual says it is optional.
    qpdf.writeFile("/range-a.pdf", readFixture("plain.pdf"));
    try {
      const res = qpdf.run([
        "--empty",
        "--pages",
        "/range-a.pdf",
        "/range-a.pdf",
        "--",
        "/range-out.pdf",
      ]);
      expect(res.code).toBe(2);
      expect(res.stderr).toMatch(/unexpected character/);
    } finally {
      qpdf.remove("/range-a.pdf");
      qpdf.remove("/range-out.pdf");
    }
  });
});
