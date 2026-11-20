// @vitest-environment node
/**
 * End to end: the real qpdf WebAssembly build encrypts, and PDFium (the PDF
 * engine in Chrome, also compiled to WebAssembly) independently checks that
 * the result opens with the password, and only with the password.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import { loadNodeQpdf, readFixture } from "@/lib/qpdf/test-utils/node-qpdf";
import { FPDF_ERR } from "@/tools/edit/engine/pdfium-api";
import {
  extractText,
  loadNodePdfium,
  type FullPdfium,
} from "@/tools/edit/test-utils/pdfium-node";
import { PdfProtector, type ProtectOutcome } from "./pdf-protector";

let qpdf: QpdfRunner;
let pdfium: FullPdfium;
let protector: PdfProtector;

beforeAll(async () => {
  qpdf = await loadNodeQpdf();
  pdfium = (await loadNodePdfium()).full;
  protector = new PdfProtector(qpdf);
}, 60_000);

/**
 * Try to open a PDF with PDFium.
 *
 * @returns "ok" with the page count, or PDFium's error code.
 */
function openWithPdfium(bytes: Uint8Array, password: string) {
  const { pdfium: rt } = pdfium;
  const ptr = rt.wasmExports.malloc(bytes.length);
  rt.HEAPU8.set(bytes, ptr);
  try {
    const doc = pdfium.FPDF_LoadMemDocument(ptr, bytes.length, password);
    if (!doc) return { error: pdfium.FPDF_GetLastError() };
    const pages = pdfium.FPDF_GetPageCount(doc);
    pdfium.FPDF_CloseDocument(doc);
    return { pages };
  } finally {
    rt.wasmExports.free(ptr);
  }
}

/** Narrow an outcome to "protected" or fail the test with what it was. */
function protectedPdf(outcome: ProtectOutcome) {
  if (outcome.kind !== "protected") {
    throw new Error(`expected protected, got ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

describe("PdfProtector with real qpdf, checked by PDFium", () => {
  it("protects a plain PDF: the password opens it, nothing else does", () => {
    const original = readFixture("plain.pdf");
    const result = protectedPdf(protector.protect(original, "hunter2"));
    expect(result.replacedRestrictions).toBe(false);
    expect(openWithPdfium(result.pdf, "hunter2")).toEqual({
      pages: openWithPdfium(original, "").pages,
    });
    expect(openWithPdfium(result.pdf, "")).toEqual({
      error: FPDF_ERR.PASSWORD,
    });
    expect(openWithPdfium(result.pdf, "hunter3")).toEqual({
      error: FPDF_ERR.PASSWORD,
    });
  });

  it("keeps the document's content", () => {
    const original = readFixture("text-chromium.pdf");
    const result = protectedPdf(protector.protect(original, "pw"));
    expect(extractText(pdfium, result.pdf, "pw")).toEqual(
      extractText(pdfium, original),
    );
  });

  it("uses AES-256 (PDF 2.0 revision 6)", () => {
    const result = protectedPdf(
      protector.protect(readFixture("plain.pdf"), "pw"),
    );
    // The encryption dictionary itself is never encrypted, so it is readable.
    const raw = Buffer.from(result.pdf).toString("latin1");
    expect(raw).toMatch(/\/V 5\b/);
    expect(raw).toMatch(/\/R 6\b/);
    expect(raw).toMatch(/\/CFM \/AESV3/);
  });

  it("replaces an owner-only restriction with the password", () => {
    const result = protectedPdf(
      protector.protect(readFixture("owner-restricted.pdf"), "pw"),
    );
    expect(result.replacedRestrictions).toBe(true);
    expect(openWithPdfium(result.pdf, "pw").pages).toBeGreaterThan(0);
    expect(openWithPdfium(result.pdf, "")).toEqual({
      error: FPDF_ERR.PASSWORD,
    });
  });

  it("leaves a PDF that already has an open password alone", () => {
    expect(protector.protect(readFixture("user-password.pdf"), "pw")).toEqual({
      kind: "already-protected",
    });
  });

  it("explains a file that is not a PDF", () => {
    expect(
      protector.protect(new TextEncoder().encode("not a pdf at all"), "pw"),
    ).toEqual({
      kind: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
  });

  it.each([
    ["Devanagari and emoji", "पासवर्ड🔐"],
    ["an argument-file lookalike", "@secret"],
    ["option lookalikes", "--print=none --"],
    ["quotes and backslashes", "q\"u\\o'te"],
    ["leading and trailing spaces", "  spaced  "],
    ["exactly 127 bytes", "x".repeat(127)],
    ["42 Devanagari letters (126 bytes)", "अ".repeat(42)],
  ])("a password with %s opens the file in PDFium", (_label, password) => {
    const result = protectedPdf(
      protector.protect(readFixture("plain.pdf"), password),
    );
    expect(openWithPdfium(result.pdf, password).pages).toBeGreaterThan(0);
    expect(openWithPdfium(result.pdf, `${password}x`)).toEqual({
      error: FPDF_ERR.PASSWORD,
    });
  });

  it("refuses a 128-byte password instead of writing an unopenable file", () => {
    expect(
      protector.protect(readFixture("plain.pdf"), "x".repeat(128)),
    ).toMatchObject({
      kind: "failed",
    });
  });

  it("can protect many files with one qpdf instance", () => {
    for (let i = 0; i < 5; i++) {
      const result = protectedPdf(
        protector.protect(readFixture("plain.pdf"), `pw${i}`),
      );
      expect(openWithPdfium(result.pdf, `pw${i}`).pages).toBeGreaterThan(0);
    }
  });
});
