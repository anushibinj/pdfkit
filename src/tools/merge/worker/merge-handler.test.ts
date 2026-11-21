import { describe, expect, it, vi } from "vitest";
import type { RetryableOnce } from "@/lib/retryable-once";
import {
  createMergeHandler,
  toCrashResult,
  toInspectResult,
  toMergeResult,
  type Merger,
} from "./merge-handler";

const ctx = () => ({ progress: vi.fn() });
const buf = (...bytes: number[]) => new Uint8Array(bytes).buffer;

function fakeMerger(overrides: Partial<Merger> = {}): Merger {
  return {
    inspect: vi.fn(() => ({ kind: "inspected" as const, pageCount: 2 })),
    merge: vi.fn(() => ({
      kind: "merged" as const,
      pdf: new Uint8Array([37, 80, 68, 70]),
    })),
    ...overrides,
  };
}

/** A memoised merger that is already loaded. */
function loaded(merger: Merger): RetryableOnce<Merger> {
  return { get: vi.fn(async () => merger), reset: vi.fn() };
}

describe("toInspectResult", () => {
  it("translates every outcome", () => {
    expect(toInspectResult({ kind: "inspected", pageCount: 3 })).toEqual({
      status: "inspected",
      pageCount: 3,
    });
    expect(toInspectResult({ kind: "password-required" })).toEqual({
      status: "password-required",
    });
    expect(toInspectResult({ kind: "wrong-password" })).toEqual({
      status: "wrong-password",
    });
    expect(toInspectResult({ kind: "failed", message: "Damaged" })).toEqual({
      status: "error",
      reason: "failed",
      message: "Damaged",
    });
  });
});

describe("toMergeResult", () => {
  it("transfers an exactly sized copy of a view into a bigger buffer", () => {
    const heap = new Uint8Array([9, 37, 80, 9]);
    const out = toMergeResult({ kind: "merged", pdf: heap.subarray(1, 3) });
    expect(out.result.status).toBe("merged");
    if (out.result.status !== "merged") throw new Error("unreachable");
    expect(Array.from(new Uint8Array(out.result.data))).toEqual([37, 80]);
    expect(out.result.data).not.toBe(heap.buffer);
    expect(out.transfer).toEqual([out.result.data]);
  });

  it("passes the failing source on", () => {
    expect(
      toMergeResult({ kind: "failed", message: "Damaged", sourceIndex: 1 }),
    ).toEqual({
      result: {
        status: "error",
        reason: "failed",
        message: "Damaged",
        sourceIndex: 1,
      },
    });
  });
});

describe("toCrashResult", () => {
  it("gives memory exhaustion its own reason", () => {
    expect(toCrashResult(new RangeError("x"))).toMatchObject({
      status: "error",
      reason: "out-of-memory",
    });
  });

  it("says the engine stopped for anything else", () => {
    expect(toCrashResult(new Error("Aborted()"))).toEqual({
      status: "error",
      reason: "failed",
      message:
        "The PDF engine stopped unexpectedly (Aborted()). Please try again.",
    });
  });
});

describe("createMergeHandler", () => {
  it("inspects one file with its password", async () => {
    const merger = fakeMerger();
    const out = await createMergeHandler(loaded(merger))(
      { op: "inspect", source: { data: buf(1, 2), password: "pw" } },
      ctx(),
    );
    expect(out).toEqual({ result: { status: "inspected", pageCount: 2 } });
    expect(merger.inspect).toHaveBeenCalledWith(new Uint8Array([1, 2]), "pw");
  });

  it("merges in order with each source's password", async () => {
    const merger = fakeMerger();
    const out = await createMergeHandler(loaded(merger))(
      {
        op: "merge",
        sources: [{ data: buf(1) }, { data: buf(2), password: "x" }],
      },
      ctx(),
    );
    expect(merger.merge).toHaveBeenCalledWith([
      { bytes: new Uint8Array([1]), password: undefined },
      { bytes: new Uint8Array([2]), password: "x" },
    ]);
    expect(out.result).toMatchObject({ status: "merged" });
    expect(out.transfer).toHaveLength(1);
  });

  it("ignores passwords that are not strings", async () => {
    const merger = fakeMerger();
    const handler = createMergeHandler(loaded(merger));
    await handler(
      {
        op: "inspect",
        source: { data: buf(1), password: 42 as unknown as string },
      },
      ctx(),
    );
    expect(merger.inspect).toHaveBeenCalledWith(new Uint8Array([1]), undefined);
    await handler(
      {
        op: "merge",
        sources: [{ data: buf(1), password: {} as unknown as string }],
      },
      ctx(),
    );
    expect(merger.merge).toHaveBeenCalledWith([
      { bytes: new Uint8Array([1]), password: undefined },
    ]);
  });

  it("reports an engine that cannot be loaded, without resetting", async () => {
    const memo: RetryableOnce<Merger> = {
      get: vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
      reset: vi.fn(),
    };
    const out = await createMergeHandler(memo)(
      { op: "inspect", source: { data: buf(1) } },
      ctx(),
    );
    expect(out.result).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: Failed to fetch",
    });
    expect(memo.reset).not.toHaveBeenCalled();
  });

  it("resets the engine after a crash and reports it", async () => {
    const memo = loaded(
      fakeMerger({
        merge: () => {
          throw new RangeError("Array buffer allocation failed");
        },
      }),
    );
    const out = await createMergeHandler(memo)(
      { op: "merge", sources: [{ data: buf(1) }] },
      ctx(),
    );
    expect(memo.reset).toHaveBeenCalledOnce();
    expect(out.result).toMatchObject({
      status: "error",
      reason: "out-of-memory",
    });
    expect(out.transfer).toBeUndefined();
  });
});
