// @vitest-environment node
import { describe, expect, it } from "vitest";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { loadNodePdfiumModule } from "@/lib/pdfium/test-utils/node-pdfium";
import type { RedactionMark } from "../core/model";
import type { RedactPdfiumApi } from "./redact-pdfium-api";
import {
  RedactionVerificationError,
  RedactionVerifier,
} from "./redaction-verifier";
import fs from "node:fs";
import path from "node:path";

describe("RedactionVerifier", () => {
  it("throws RedactionVerificationError when a redacted term is still present in the reopened PDF", async () => {
    const full = await loadNodePdfiumModule();
    const api = full as unknown as RedactPdfiumApi;
    const heap = new WasmHeap(api.pdfium);
    const verifier = new RedactionVerifier(api, heap);

    const bytes = new Uint8Array(
      fs.readFileSync(path.resolve("fixtures/text-chromium.pdf")),
    );
    const leakedMark: RedactionMark = {
      id: "m1",
      pageIndex: 0,
      box: { left: 10, bottom: 10, right: 200, top: 800 },
      term: "Total amount due",
      source: "text",
      label: "Text",
      enabled: true,
    };

    expect(() =>
      verifier.verify(bytes, [leakedMark], "REDACTED"),
    ).toThrow(RedactionVerificationError);
  });

  it("verifies successfully when no redacted term remains in the reopened PDF", async () => {
    const full = await loadNodePdfiumModule();
    const api = full as unknown as RedactPdfiumApi;
    const heap = new WasmHeap(api.pdfium);
    const verifier = new RedactionVerifier(api, heap);

    const bytes = new Uint8Array(
      fs.readFileSync(path.resolve("fixtures/text-chromium.pdf")),
    );
    const absentMark: RedactionMark = {
      id: "m1",
      pageIndex: 0,
      box: { left: 5, bottom: 5, right: 10, top: 10 },
      term: "NON_EXISTENT_SECRET_TOKEN_XYZ",
      source: "text",
      label: "Text",
      enabled: true,
    };

    const report = verifier.verify(bytes, [absentMark], "REDACTED");
    expect(report.verified).toBe(true);
    expect(report.summary).toBe("0 of 1 redacted terms remain");
  });
});
