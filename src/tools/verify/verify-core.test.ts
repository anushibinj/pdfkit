// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findSignatures, verifyPdf } from "./verify-core";

const signed = () =>
  new Uint8Array(readFileSync(new URL("../../../fixtures/signed.pdf", import.meta.url)));

describe("verifyPdf", () => {
  it("finds the signature in the fixture", () => {
    const { found, skipped } = findSignatures(signed());
    expect(found).toHaveLength(1);
    expect(skipped).toBe(0);
  });

  it("accepts an untouched signed PDF", async () => {
    const [r] = await verifyPdf(signed());
    expect(r.status).toBe("valid");
    expect(r.signer).toBe("PDFKit Test Signer");
    expect(r.coversWholeFile).toBe(true);
  });

  it("rejects a PDF edited after signing", async () => {
    const pdf = signed();
    const at = new TextDecoder("latin1").decode(pdf).indexOf("300 200");
    pdf[at] = 0x39; // MediaBox 300 -> 900
    const [r] = await verifyPdf(pdf);
    expect(r.status).toBe("invalid");
  });

  it("reports nothing for an unsigned PDF", async () => {
    const plain = new Uint8Array(
      readFileSync(new URL("../../../fixtures/plain.pdf", import.meta.url)),
    );
    expect(await verifyPdf(plain)).toEqual([]);
  });
});
