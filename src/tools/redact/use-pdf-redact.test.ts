import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RedactEngine } from "./redact-engine";
import { jobFromApplyResult, usePdfRedact } from "./use-pdf-redact";

function createFakeEngine() {
  const open = vi.fn(async (_buf: ArrayBuffer, password = "") => {
    if (password === "") return { status: "needs-password" as const, wrong: false };
    if (password === "hunter2") {
      return {
        status: "opened" as const,
        pages: [
          { box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 as const },
        ],
      };
    }
    return { status: "needs-password" as const, wrong: true };
  });
  const render = vi.fn(async () => ({
    status: "rendered" as const,
    width: 10,
    height: 10,
    pixels: new ArrayBuffer(400),
  }));
  const textUnderBox = vi.fn(async () => ({
    status: "text-extracted" as const,
    text: "PAN123",
  }));
  const search = vi.fn(async () => ({
    status: "searched" as const,
    matches: [],
  }));
  const applyRedactions = vi.fn(async () => ({
    status: "redacted" as const,
    data: new ArrayBuffer(8),
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
      verification: {
        verified: true,
        totalTerms: 1,
        remainingTerms: 0,
        leakedTerms: [],
        summary: "0 of 1 redacted terms remain",
      },
    },
  }));
  const close = vi.fn(async () => {});
  const dispose = vi.fn();

  return {
    open,
    render,
    textUnderBox,
    search,
    applyRedactions,
    close,
    dispose,
  } as unknown as RedactEngine;
}

describe("usePdfRedact", () => {
  it("handles password-protected open, text extraction, search, apply, and close", async () => {
    const engine = createFakeEngine();
    const { result } = renderHook(() => usePdfRedact(() => engine));

    const file = new File([new Uint8Array([1, 2, 3, 4])], "locked.pdf", {
      type: "application/pdf",
    });

    await act(async () => {
      await result.current.openFile(file);
    });
    expect(result.current.status).toEqual({
      kind: "needs-password",
      fileName: "locked.pdf",
      wrong: false,
    });

    await act(async () => {
      await result.current.submitPassword("hunter2");
    });
    expect(result.current.status.kind).toBe("ready");

    let text = "";
    await act(async () => {
      text = await result.current.extractTextUnderBox(0, {
        left: 0,
        bottom: 0,
        right: 50,
        top: 20,
      });
    });
    expect(text).toBe("PAN123");

    await act(async () => {
      await result.current.applyRedactions({
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
      });
    });
    expect(result.current.job.kind).toBe("done");

    act(() => result.current.resetJob());
    expect(result.current.job.kind).toBe("idle");

    act(() => result.current.close());
    expect(result.current.status.kind).toBe("empty");
  });

  it("maps verification-failed apply results to failed job status", () => {
    const failed = jobFromApplyResult({
      status: "verification-failed",
      verification: {
        verified: false,
        totalTerms: 2,
        remainingTerms: 1,
        leakedTerms: [{ pageIndex: 0, term: "SECRET" }],
        summary: "1 of 2 redacted terms remain",
      },
      message: "Verification failed (1 of 2 redacted terms remain).",
    });
    expect(failed).toEqual({
      kind: "failed",
      message: "Verification failed (1 of 2 redacted terms remain).",
    });
  });
});
