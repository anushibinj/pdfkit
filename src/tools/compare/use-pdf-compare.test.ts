import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CompareEngine } from "./compare-engine";
import type { CompareSummary } from "./core/model";
import { usePdfCompare } from "./use-pdf-compare";

function makePdfFile(name: string): File {
  const file = new File(["%PDF-1.4"], name, { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new ArrayBuffer(8)),
  });
  return file;
}

describe("usePdfCompare", () => {
  const summary: CompareSummary = {
    leftFileName: "a.pdf",
    rightFileName: "b.pdf",
    leftPageCount: 1,
    rightPageCount: 1,
    pairs: [],
    totalChanges: 0,
    addedWords: 0,
    removedWords: 0,
    scannedPagesCount: 0,
  };

  function makeFakeEngine() {
    let lockedOnce = true;
    const engine: CompareEngine = {
      openSide: vi.fn(async (side, fileName, _bytes, password) => {
        if (fileName === "b.pdf" && lockedOnce && password === "") {
          lockedOnce = false;
          return { status: "needs-password", side, wrong: false };
        }
        if (fileName === "b.pdf" && password !== "secret") {
          return { status: "needs-password", side, wrong: true };
        }
        return {
          status: "opened",
          side,
          pageCount: 1,
          scannedPages: 0,
          summary: side === "right" ? summary : null,
        };
      }),
      renderPage: vi.fn(async () => ({
        status: "rendered",
        width: 100,
        height: 100,
        pixels: new ArrayBuffer(4),
      })),
      computeVisualDiff: vi.fn(async () => ({
        status: "visual-diff",
        pixels: new ArrayBuffer(4),
        summary: {
          pairIndex: 0,
          width: 100,
          height: 100,
          leftWidth: 100,
          leftHeight: 100,
          rightWidth: 100,
          rightHeight: 100,
          sizeMismatch: false,
          changedPixels: 0,
          totalPixels: 10000,
          percentChanged: 0,
          regions: [],
        },
      })),
      buildReport: vi.fn(async () => ({
        status: "report",
        data: new ArrayBuffer(12),
      })),
      closeSide: vi.fn(async () => {}),
      closeAll: vi.fn(async () => {}),
      dispose: vi.fn(),
    } as unknown as CompareEngine;

    return engine;
  }

  it("opens both files, handles password prompts, swaps, exports report, and resets", async () => {
    const engine = makeFakeEngine();
    const { result, unmount } = renderHook(() => usePdfCompare(() => engine));

    await act(async () => {
      await result.current.openFile("left", makePdfFile("a.pdf"));
    });
    expect(result.current.left.kind).toBe("ready");
    expect(result.current.summary).toBeNull();

    await act(async () => {
      await result.current.openFile("right", makePdfFile("b.pdf"));
    });
    expect(result.current.right.kind).toBe("needs-password");

    await act(async () => {
      await result.current.submitPassword("right", "secret");
    });
    expect(result.current.right.kind).toBe("ready");
    expect(result.current.summary).toEqual(summary);

    const report = await act(async () => result.current.exportReport());
    expect(report.status).toBe("report");

    await act(async () => {
      await result.current.swapSides();
    });
    expect(result.current.left).toMatchObject({ kind: "ready", fileName: "b.pdf" });
    expect(result.current.right).toMatchObject({ kind: "ready", fileName: "a.pdf" });

    act(() => {
      result.current.resetAll();
    });
    expect(result.current.left.kind).toBe("empty");
    expect(result.current.right.kind).toBe("empty");
    expect(result.current.summary).toBeNull();

    unmount();
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });
});
