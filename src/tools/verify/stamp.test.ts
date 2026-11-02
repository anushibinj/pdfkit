// @vitest-environment node
import { readFileSync } from "node:fs";
import { PDFArray, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { stampVerified } from "./stamp";
import { verifyPdf } from "./verify-core";

const fixture = () => {
  const buf = readFileSync(new URL("../../../fixtures/signed.pdf", import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};
const OPTS = { signatureCount: 1, verifiedAt: "2026-11-02T00:00:00Z" };

describe("stampVerified (incremental update)", () => {
  it("keeps the original bytes untouched", async () => {
    const input = fixture();
    const out = new Uint8Array(await stampVerified(input, OPTS));
    expect(out.length).toBeGreaterThan(input.byteLength);
    expect(Buffer.compare(Buffer.from(out.subarray(0, input.byteLength)), Buffer.from(input))).toBe(0);
  });

  it("leaves the original signature valid", async () => {
    const out = new Uint8Array(await stampVerified(fixture(), OPTS));
    const [r] = await verifyPdf(out);
    expect(r.status).toBe("valid");
    // Bytes were appended after the signature, which we report honestly.
    expect(r.coversWholeFile).toBe(false);
  });

  it("adds a stamp annotation to the page", async () => {
    const out = await stampVerified(fixture(), OPTS);
    const doc = await PDFDocument.load(out);
    const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(2); // signature widget + stamp
  });

  it("can be stamped twice", async () => {
    const once = await stampVerified(fixture(), OPTS);
    const twice = await stampVerified(once, OPTS);
    const doc = await PDFDocument.load(twice);
    expect(doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size()).toBe(3);
    const [r] = await verifyPdf(new Uint8Array(twice));
    expect(r.status).toBe("valid");
  });

  it("handles files that use a cross-reference stream", async () => {
    const src = await PDFDocument.create();
    src.addPage([300, 200]);
    const bytes = await src.save({ useObjectStreams: true });
    const input = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const out = await stampVerified(input, OPTS);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size()).toBe(1);
  });
});
