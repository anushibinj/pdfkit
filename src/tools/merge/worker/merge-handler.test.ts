import { describe, expect, it, vi } from "vitest";
import type { PdfMerger } from "../core/pdf-merger";
import { createMergeHandler, toFailure } from "./merge-handler";

const ctx = () => ({ progress: vi.fn() });
const buf = (...bytes: number[]) => new Uint8Array(bytes).buffer;

function fakeMerger(overrides: Partial<PdfMerger> = {}): PdfMerger {
  return {
    inspect: vi.fn(() => ({ status: "inspected" as const, pageCount: 2 })),
    merge: vi.fn(() => ({
      status: "merged" as const,
      bytes: new Uint8Array([37, 80, 68, 70]),
    })),
    ...overrides,
  };
}

describe("toFailure", () => {
  it("gives memory exhaustion its own reason", () => {
    expect(
      toFailure(new RangeError("Array buffer allocation failed")),
    ).toMatchObject({
      status: "error",
      reason: "out-of-memory",
    });
  });

  it("passes other errors through", () => {
    expect(toFailure("boom")).toEqual({
      status: "error",
      reason: "failed",
      message: "boom",
    });
  });
});

describe("createMergeHandler", () => {
  it("inspects one file with its password", async () => {
    const merger = fakeMerger();
    const handler = createMergeHandler(async () => merger, vi.fn());
    const out = await handler(
      { op: "inspect", source: { data: buf(1, 2), password: "pw" } },
      ctx(),
    );
    expect(out).toEqual({ result: { status: "inspected", pageCount: 2 } });
    expect(merger.inspect).toHaveBeenCalledWith({
      bytes: new Uint8Array([1, 2]),
      password: "pw",
    });
  });

  it("merges in order and transfers the result's buffer", async () => {
    const merger = fakeMerger();
    const handler = createMergeHandler(async () => merger, vi.fn());
    const out = await handler(
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
    expect(out.result).toMatchObject({ status: "merged", warnings: undefined });
    if (out.result.status !== "merged") throw new Error("unreachable");
    expect(Array.from(new Uint8Array(out.result.data))).toEqual([
      37, 80, 68, 70,
    ]);
    expect(out.transfer).toEqual([out.result.data]);
  });

  it("passes merge warnings on", async () => {
    const merger = fakeMerger({
      merge: () => ({
        status: "merged",
        bytes: new Uint8Array([1]),
        warnings: "Repaired",
      }),
    });
    const out = await createMergeHandler(async () => merger, vi.fn())(
      { op: "merge", sources: [{ data: buf(1) }] },
      ctx(),
    );
    expect(out.result).toMatchObject({
      status: "merged",
      warnings: "Repaired",
    });
  });

  it("reports a failed merge with the failing source", async () => {
    const merger = fakeMerger({
      merge: () => ({ status: "failed", message: "Damaged", sourceIndex: 1 }),
    });
    const out = await createMergeHandler(async () => merger, vi.fn())(
      { op: "merge", sources: [{ data: buf(1) }, { data: buf(2) }] },
      ctx(),
    );
    expect(out).toEqual({
      result: {
        status: "error",
        reason: "failed",
        message: "Damaged",
        sourceIndex: 1,
      },
    });
  });

  it("reports an engine that cannot be loaded, without resetting", async () => {
    const reset = vi.fn();
    const out = await createMergeHandler(async () => {
      throw new Error("Failed to fetch");
    }, reset)({ op: "inspect", source: { data: buf(1) } }, ctx());
    expect(out.result).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: Failed to fetch",
    });
    expect(reset).not.toHaveBeenCalled();
  });

  it("resets the engine after a crash and reports it", async () => {
    const reset = vi.fn();
    const merger = fakeMerger({
      merge: () => {
        throw new RangeError("Array buffer allocation failed");
      },
    });
    const out = await createMergeHandler(async () => merger, reset)(
      { op: "merge", sources: [{ data: buf(1) }] },
      ctx(),
    );
    expect(reset).toHaveBeenCalledOnce();
    expect(out.result).toMatchObject({
      status: "error",
      reason: "out-of-memory",
    });
    expect(out.transfer).toBeUndefined();
  });
});
