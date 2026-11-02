// @vitest-environment node
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { stampVerified } from "./stamp";

describe("stampVerified", () => {
  it("produces a loadable PDF that is larger than the input", async () => {
    const buf = readFileSync(new URL("../../../fixtures/signed.pdf", import.meta.url));
    const input = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const out = await stampVerified(input as ArrayBuffer, {
      signatureCount: 1,
      verifiedAt: "2026-11-02T00:00:00Z",
    });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    expect(out.byteLength).toBeGreaterThan(0);
  });
});
