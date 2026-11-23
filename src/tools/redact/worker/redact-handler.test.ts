import { describe, expect, it, vi } from "vitest";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import { InvalidRedactionPlanError } from "../core/sanitize-plan";
import { RedactModuleError } from "../engine/redact-session";
import { RedactionVerificationError } from "../engine/redaction-verifier";
import {
  createRedactHandler,
  handleRequest,
  toErrorResult,
  type RedactWorkerSession,
} from "./redact-handler";

function makeSession(): RedactWorkerSession {
  return {
    open: vi.fn(() => [
      { box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 as const },
    ]),
    render: vi.fn(() => ({
      width: 2,
      height: 2,
      pixels: new Uint8Array(16),
    })),
    textUnderBox: vi.fn(() => "alice@example.com"),
    search: vi.fn(() => []),
    applyRedactions: vi.fn(async () => ({
      pdf: Uint8Array.of(37, 80, 68, 70),
      report: {
        pagesRedacted: 1,
        marksApplied: 1,
        textObjectsRemoved: 1,
        textObjectsSplit: 0,
        imagesModified: 0,
        pathsRemoved: 0,
        annotationsRemoved: 0,
        pagesRasterized: 0,
        sanitize: {
          metadataEntriesRemoved: 1,
          xmpStreamsRemoved: 0,
          attachmentsRemoved: 0,
          javascriptActionsRemoved: 0,
          hiddenLayersRemoved: 0,
          bookmarksCleaned: 0,
          annotationsRemoved: 0,
          formValuesCleared: 0,
          objectsPruned: 2,
        },
        verification: {
          verified: true,
          totalTerms: 1,
          remainingTerms: 0,
          leakedTerms: [],
          summary: "0 of 1 redacted terms remain",
        },
      },
    })),
    close: vi.fn(),
  };
}

const ctx = { progress: vi.fn() };

describe("redact-handler", () => {
  it("handles open, password prompts, render, text-under-box, search, apply, and close", async () => {
    const session = makeSession();
    const openRes = await handleRequest(
      session,
      { op: "open", data: new ArrayBuffer(4), password: "" },
      ctx,
    );
    expect(openRes.result.status).toBe("opened");

    const renderRes = await handleRequest(
      session,
      { op: "render", pageIndex: 0, width: 400 },
      ctx,
    );
    expect(renderRes.result.status).toBe("rendered");
    expect(renderRes.transfer).toHaveLength(1);

    const textRes = await handleRequest(
      session,
      {
        op: "text-under-box",
        pageIndex: 0,
        box: { left: 0, bottom: 0, right: 50, top: 20 },
      },
      ctx,
    );
    expect(textRes.result).toEqual({
      status: "text-extracted",
      text: "alice@example.com",
    });

    const searchRes = await handleRequest(
      session,
      { op: "search", query: { mode: "presets", presets: ["email"] } },
      ctx,
    );
    expect(searchRes.result.status).toBe("searched");

    const applyRes = await handleRequest(
      session,
      {
        op: "apply",
        plan: {
          marks: [],
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
      },
      ctx,
    );
    expect(applyRes.result.status).toBe("redacted");
    expect(applyRes.transfer).toHaveLength(1);

    const closeRes = await handleRequest(session, { op: "close" }, ctx);
    expect(closeRes.result).toEqual({ status: "closed" });
  });

  it("maps password, verification, and module errors to dedicated statuses", async () => {
    const session = makeSession();
    (session.open as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new PdfOpenError("password");
    });
    const needsPw = await handleRequest(
      session,
      { op: "open", data: new ArrayBuffer(4), password: "" },
      ctx,
    );
    expect(needsPw.result).toEqual({ status: "needs-password", wrong: false });

    (session.applyRedactions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new RedactionVerificationError({
        verified: false,
        totalTerms: 2,
        remainingTerms: 1,
        leakedTerms: [{ pageIndex: 0, term: "SECRET" }],
        summary: "1 of 2 redacted terms remain",
      }),
    );
    const verifyFail = await handleRequest(
      session,
      {
        op: "apply",
        plan: {
          marks: [],
          style: { fill: "black", label: "" },
          cleanup: {
            metadata: true,
            attachments: true,
            javascript: true,
            hiddenLayers: true,
            bookmarks: true,
          },
          rasterizePages: false,
        },
      },
      ctx,
    );
    expect(verifyFail.result.status).toBe("verification-failed");

    (session.applyRedactions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new RedactModuleError("encrypted", "Encrypted"),
    );
    const modFail = await handleRequest(
      session,
      {
        op: "apply",
        plan: {
          marks: [],
          style: { fill: "black", label: "" },
          cleanup: {
            metadata: true,
            attachments: true,
            javascript: true,
            hiddenLayers: true,
            bookmarks: true,
          },
          rasterizePages: false,
        },
      },
      ctx,
    );
    expect(modFail.result).toEqual({
      status: "error",
      reason: "failed",
      message: "Encrypted",
    });
  });

  it("classifies OOM, WASM crashes, and invalid plans in toErrorResult", async () => {
    expect(toErrorResult(new RangeError("out of memory")).reason).toBe(
      "out-of-memory",
    );
    expect(
      toErrorResult(new InvalidRedactionPlanError("bad box")).message,
    ).toContain("bad box");
    expect(
      toErrorResult(new WebAssembly.RuntimeError("unreachable")).reason,
    ).toBe("crashed");

    const handler = createRedactHandler(async () => {
      throw new Error("network down");
    });
    expect((await handler({ op: "close" }, ctx)).result).toEqual({
      status: "closed",
    });
    expect(
      (
        await handler(
          { op: "search", query: { mode: "presets", presets: ["email"] } },
          ctx,
        )
      ).result,
    ).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: network down",
    });
  });
});
