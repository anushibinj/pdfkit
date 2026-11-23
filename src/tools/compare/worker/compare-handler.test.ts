import { describe, expect, it, vi } from "vitest";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import type { HandlerContext } from "@/lib/worker-protocol";
import {
  createCompareHandler,
  handleCompareRequest,
  toCompareErrorResult,
  type CompareSessionPort,
} from "./compare-handler";

function makeSession(): CompareSessionPort {
  return {
    openSide: vi.fn(() => ({
      side: "left" as const,
      pageCount: 2,
      scannedPages: 0,
      summary: null,
    })),
    renderPage: vi.fn(() => ({
      width: 100,
      height: 120,
      pixels: new Uint8Array(100 * 120 * 4),
    })),
    computeVisualDiff: vi.fn(() => ({
      pixels: new Uint8Array(100 * 120 * 4),
      summary: {
        pairIndex: 0,
        width: 100,
        height: 120,
        leftWidth: 100,
        leftHeight: 120,
        rightWidth: 100,
        rightHeight: 120,
        sizeMismatch: false,
        changedPixels: 10,
        totalPixels: 12000,
        percentChanged: 0.08,
        regions: [],
      },
    })),
    buildReport: vi.fn(() => new Uint8Array([37, 80, 68, 70])),
    closeSide: vi.fn(),
    closeAll: vi.fn(),
  };
}

describe("compare-handler", () => {
  const ctx: HandlerContext = { progress: vi.fn() };

  it("classifies OOM, WASM traps, and generic errors", () => {
    expect(toCompareErrorResult(new RangeError("out of memory")).reason).toBe(
      "out-of-memory",
    );
    expect(
      toCompareErrorResult(new WebAssembly.RuntimeError("unreachable")).reason,
    ).toBe("crashed");
    expect(toCompareErrorResult(new Error("bad input")).reason).toBe("failed");
  });

  it("handles open, password-needed, render, visual-diff, build-report, and close", async () => {
    const session = makeSession();

    const opened = await handleCompareRequest(
      session,
      {
        op: "open",
        side: "left",
        fileName: "a.pdf",
        data: new ArrayBuffer(4),
        password: "",
      },
      ctx,
    );
    expect(opened.result.status).toBe("opened");

    vi.mocked(session.openSide).mockImplementationOnce(() => {
      throw new PdfOpenError("password");
    });
    const locked = await handleCompareRequest(
      session,
      {
        op: "open",
        side: "right",
        fileName: "b.pdf",
        data: new ArrayBuffer(4),
        password: "wrong",
      },
      ctx,
    );
    expect(locked.result).toEqual({
      status: "needs-password",
      side: "right",
      wrong: true,
    });

    const rendered = await handleCompareRequest(
      session,
      { op: "render", side: "left", pageIndex: 0, width: 100 },
      ctx,
    );
    expect(rendered.result.status).toBe("rendered");
    expect(rendered.transfer).toHaveLength(1);

    const visual = await handleCompareRequest(
      session,
      { op: "visual-diff", pairIndex: 0, width: 100 },
      ctx,
    );
    expect(visual.result.status).toBe("visual-diff");
    expect(visual.transfer).toHaveLength(1);

    const report = await handleCompareRequest(
      session,
      { op: "build-report" },
      ctx,
    );
    expect(report.result.status).toBe("report");
    expect(report.transfer).toHaveLength(1);

    expect(
      (await handleCompareRequest(session, { op: "close-side", side: "left" }, ctx))
        .result,
    ).toEqual({ status: "closed" });
    expect(
      (await handleCompareRequest(session, { op: "close-all" }, ctx)).result,
    ).toEqual({ status: "closed" });
  });

  it("wraps engine load failures gracefully in createCompareHandler", async () => {
    const handler = createCompareHandler(() =>
      Promise.reject(new Error("offline")),
    );
    const closeRes = await handler({ op: "close-all" }, ctx);
    expect(closeRes.result).toEqual({ status: "closed" });

    const openRes = await handler(
      {
        op: "open",
        side: "left",
        fileName: "a.pdf",
        data: new ArrayBuffer(4),
        password: "",
      },
      ctx,
    );
    expect(openRes.result.status).toBe("error");
    if (openRes.result.status === "error") {
      expect(openRes.result.message).toContain("Could not load the PDF engine");
    }
  });
});
