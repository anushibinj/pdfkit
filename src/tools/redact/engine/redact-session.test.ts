// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadNodePdfiumModule } from "@/lib/pdfium/test-utils/node-pdfium";
import { StandardFontMetricsSource } from "@/tools/edit/core/standard-font-metrics";
import { PDFDocument } from "pdf-lib";
import { PdfRedactModule } from "./pdf-redact-module";
import type { RedactPdfiumApi } from "./redact-pdfium-api";
import { RedactModuleError, RedactSession } from "./redact-session";
import { RedactionVerificationError } from "./redaction-verifier";
import fs from "node:fs";
import path from "node:path";

async function loadRealSanitizer() {
  const wasmBytes = fs.readFileSync(
    path.resolve("crates/pdf-redact/dist/pdf_redact.wasm"),
  );
  const ab = wasmBytes.buffer.slice(
    wasmBytes.byteOffset,
    wasmBytes.byteOffset + wasmBytes.byteLength,
  );
  return PdfRedactModule.load("/wasm/pdf-redact.wasm", async () => ab);
}

describe("RedactSession (integration with real PDFium + pdf-redact.wasm)", () => {
  it("searches, redacts straddling text, purges object graph, and verifies 0 remaining terms", async () => {
    const full = await loadNodePdfiumModule();
    const api = full as unknown as RedactPdfiumApi;
    const session = new RedactSession(
      api,
      new StandardFontMetricsSource(),
      loadRealSanitizer,
    );

    const bytes = new Uint8Array(
      fs.readFileSync(path.resolve("fixtures/text-chromium.pdf")),
    );
    const pages = session.open(bytes, "");
    expect(pages.length).toBeGreaterThan(0);

    const hits = session.search({
      mode: "text",
      query: "1250",
      caseSensitive: false,
    });
    expect(hits.length).toBe(1);

    const marks = hits.map((h, i) => ({ ...h, id: `m${i}` }));
    const stages: string[] = [];
    const outcome = await session.applyRedactions(
      {
        marks,
        style: { fill: "black", label: "REDACTED" },
        cleanup: {
          metadata: true,
          attachments: true,
          javascript: true,
          hiddenLayers: true,
          bookmarks: true,
        },
        rasterizePages: false,
      },
      (stage) => stages.push(stage),
    );

    expect(stages).toContain("redacting");
    expect(stages).toContain("cleaning");
    expect(stages).toContain("verifying");
    expect(outcome.report.verification.verified).toBe(true);
    expect(outcome.report.verification.summary).toBe(
      "0 of 1 redacted terms remain",
    );
    expect(new TextDecoder().decode(outcome.pdf.slice(0, 5))).toBe("%PDF-");
    session.close();
  });

  it("purges earlier incremental revisions and document metadata so old text is unrecoverable", async () => {
    // Build a PDF with an Info dictionary, then append an incremental revision
    // containing an old secret token before a second %%EOF.
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 400]);
    page.drawText("Invoice SECRET-PAN-ABCPK1234F confirmed", {
      x: 40,
      y: 300,
      size: 14,
    });
    pdfDoc.setAuthor("Alice Secret Author");
    pdfDoc.setSubject("SECRET-PAN-ABCPK1234F");
    const baseBytes = await pdfDoc.save({ useObjectStreams: false });

    // Append a simulated incremental update comment/revision with a second %%EOF
    // using raw byte concatenation (never UTF-8 re-encoding binary PDF bytes).
    const extraBytes = new TextEncoder().encode(
      "\n% Incremental revision with OLD_INCREMENTAL_LEAK\n%%EOF\n",
    );
    const incrementalBytes = new Uint8Array(
      baseBytes.length + extraBytes.length,
    );
    incrementalBytes.set(baseBytes, 0);
    incrementalBytes.set(extraBytes, baseBytes.length);

    const full = await loadNodePdfiumModule();
    const api = full as unknown as RedactPdfiumApi;
    const session = new RedactSession(
      api,
      new StandardFontMetricsSource(),
      loadRealSanitizer,
    );
    session.open(incrementalBytes, "");

    const panHits = session.search({ mode: "presets", presets: ["pan"] });
    expect(panHits.length).toBe(1);
    expect(panHits[0].term).toBe("ABCPK1234F");

    const outcome = await session.applyRedactions({
      marks: panHits.map((h, i) => ({ ...h, id: `p${i}` })),
      style: { fill: "black", label: "REDACTED" },
      cleanup: {
        metadata: true,
        attachments: true,
        javascript: true,
        hiddenLayers: true,
        bookmarks: true,
      },
      rasterizePages: false,
    });

    const outStr = new TextDecoder("latin1").decode(outcome.pdf);
    expect(outStr).not.toContain("ABCPK1234F");
    expect(outStr).not.toContain("OLD_INCREMENTAL_LEAK");
    expect(outStr).not.toContain("Alice Secret Author");
    expect(outStr.match(/%%EOF/g)?.length).toBe(1);
    expect(outcome.report.sanitize.metadataEntriesRemoved).toBeGreaterThan(0);
    expect(outcome.report.verification.verified).toBe(true);
    session.close();
  });

  it("supports maximum-certainty rasterizePages fallback and refuses download on failure", async () => {
    const full = await loadNodePdfiumModule();
    const api = full as unknown as RedactPdfiumApi;
    const session = new RedactSession(
      api,
      new StandardFontMetricsSource(),
      loadRealSanitizer,
    );

    const bytes = new Uint8Array(
      fs.readFileSync(path.resolve("fixtures/text-chromium.pdf")),
    );
    session.open(bytes, "");
    const hits = session.search({
      mode: "text",
      query: "billing",
      caseSensitive: false,
    });
    expect(hits.length).toBeGreaterThan(0);

    const outcome = await session.applyRedactions({
      marks: hits.map((h, i) => ({ ...h, id: `r${i}` })),
      style: { fill: "white", label: "HIDDEN" },
      cleanup: {
        metadata: true,
        attachments: true,
        javascript: true,
        hiddenLayers: true,
        bookmarks: true,
      },
      rasterizePages: true,
    });

    expect(outcome.report.pagesRasterized).toBe(1);
    expect(outcome.report.verification.verified).toBe(true);
    session.close();

    // Error propagation when sanitizer fails
    const failingSession = new RedactSession(
      api,
      new StandardFontMetricsSource(),
      async () => ({
        sanitize: () => ({ ok: false, code: "write-failed", message: "boom" }),
      }),
    );
    failingSession.open(bytes, "");
    await expect(
      failingSession.applyRedactions({
        marks: hits.map((h, i) => ({ ...h, id: `r${i}` })),
        style: { fill: "black", label: "" },
        cleanup: {
          metadata: true,
          attachments: true,
          javascript: true,
          hiddenLayers: true,
          bookmarks: true,
        },
        rasterizePages: false,
      }),
    ).rejects.toThrow(RedactModuleError);
    failingSession.close();

    // Refuses download with RedactionVerificationError when a term survives
    const leakingSession = new RedactSession(
      api,
      new StandardFontMetricsSource(),
      async () => ({
        sanitize: () => ({
          ok: true,
          pdf: bytes,
          report: {
            metadataEntriesRemoved: 0,
            xmpStreamsRemoved: 0,
            attachmentsRemoved: 0,
            javascriptActionsRemoved: 0,
            hiddenLayersRemoved: 0,
            bookmarksCleaned: 0,
            annotationsRemoved: 0,
            formValuesCleared: 0,
            objectsPruned: 0,
          },
        }),
      }),
    );
    leakingSession.open(bytes, "");
    await expect(
      leakingSession.applyRedactions({
        marks: hits.map((h, i) => ({ ...h, id: `r${i}` })),
        style: { fill: "black", label: "" },
        cleanup: {
          metadata: true,
          attachments: true,
          javascript: true,
          hiddenLayers: true,
          bookmarks: true,
        },
        rasterizePages: false,
      }),
    ).rejects.toThrow(RedactionVerificationError);
    leakingSession.close();
  });
});
