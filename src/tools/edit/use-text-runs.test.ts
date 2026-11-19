import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TextRun } from "./core/text-runs";
import type { TextRunsResult } from "./messages";
import { useTextRuns } from "./use-text-runs";

const run = { id: "0", text: "Hi" } as TextRun;

describe("useTextRuns", () => {
  it("loads only when enabled", async () => {
    const load = vi.fn(async (): Promise<TextRunsResult> => ({
      status: "text-runs",
      runs: [run],
    }));
    const { result, rerender } = renderHook(
      ({ enabled }) => useTextRuns(load, 2, enabled),
      { initialProps: { enabled: false } },
    );
    expect(result.current).toEqual({ runs: null, error: null });
    expect(load).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() =>
      expect(result.current).toEqual({ runs: [run], error: null }),
    );
    expect(load).toHaveBeenCalledWith(2);
  });

  it("reports a failure", async () => {
    const load = vi.fn(async (): Promise<TextRunsResult> => ({
      status: "error",
      reason: "failed",
      message: "no text",
    }));
    const { result } = renderHook(() => useTextRuns(load, 0, true));
    await waitFor(() =>
      expect(result.current).toEqual({ runs: null, error: "no text" }),
    );
  });

  it("ignores an answer for a page the slot no longer shows", async () => {
    let answer: (r: TextRunsResult) => void = () => {};
    const load = vi
      .fn<(i: number) => Promise<TextRunsResult>>()
      .mockImplementationOnce(() => new Promise((r) => (answer = r)))
      .mockImplementation(async () => ({ status: "text-runs", runs: [] }));
    const { result, rerender } = renderHook(
      ({ index }) => useTextRuns(load, index, true),
      { initialProps: { index: 0 } },
    );
    rerender({ index: 1 });
    await waitFor(() => expect(result.current.runs).toEqual([]));
    await act(async () => answer({ status: "text-runs", runs: [run] }));
    expect(result.current.runs).toEqual([]);
  });
});
