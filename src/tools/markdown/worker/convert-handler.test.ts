import { describe, expect, it, vi } from "vitest";
import type { ConvertRequest } from "../messages";
import {
  createConvertHandler,
  toErrorResult,
  toTransferableBuffer,
  type Converter,
} from "./convert-handler";

const request: ConvertRequest = {
  markdown: "# x",
  css: "",
  page: { size: "A4", marginMm: 20 },
};

const ctx = () => ({ progress: vi.fn() });

describe("toTransferableBuffer", () => {
  it("reuses a buffer the view fully covers", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(toTransferableBuffer(bytes)).toBe(bytes.buffer);
  });

  it("copies a partial view into an exact-size buffer", () => {
    const big = new Uint8Array([9, 1, 2, 3, 9]);
    const out = toTransferableBuffer(big.subarray(1, 4));
    expect(out).not.toBe(big.buffer);
    expect(Array.from(new Uint8Array(out))).toEqual([1, 2, 3]);
  });
});

describe("toErrorResult", () => {
  it("classifies memory exhaustion", () => {
    expect(
      toErrorResult(new RangeError("Array buffer allocation failed")).reason,
    ).toBe("out-of-memory");
  });

  it("classifies WebAssembly traps as crashes", () => {
    const result = toErrorResult(new WebAssembly.RuntimeError("unreachable"));
    expect(result.reason).toBe("crashed");
    expect(result.message).toContain("unreachable");
  });

  it("passes other errors through as failures", () => {
    expect(toErrorResult("unknown page size `A3`")).toEqual({
      status: "error",
      reason: "failed",
      message: "unknown page size `A3`",
    });
  });
});

describe("createConvertHandler", () => {
  it("converts and transfers the PDF buffer", async () => {
    const converter: Converter = {
      convert: vi.fn(() => new Uint8Array([37, 80])),
    };
    const c = ctx();
    const out = await createConvertHandler(async () => converter)(request, c);
    expect(converter.convert).toHaveBeenCalledWith(request);
    expect(out.result.status).toBe("converted");
    if (out.result.status !== "converted") throw new Error("unreachable");
    expect(Array.from(new Uint8Array(out.result.data))).toEqual([37, 80]);
    expect(out.transfer).toEqual([out.result.data]);
    expect(c.progress).toHaveBeenCalled();
  });

  it("reports a failure to load the engine", async () => {
    const out = await createConvertHandler(async () => {
      throw new Error("Failed to fetch");
    })(request, ctx());
    expect(out.result).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: Failed to fetch",
    });
    expect(out.transfer).toBeUndefined();
  });

  it("reports conversion errors as results instead of rejecting", async () => {
    const converter: Converter = {
      convert: () => {
        throw new WebAssembly.RuntimeError("unreachable");
      },
    };
    const out = await createConvertHandler(async () => converter)(
      request,
      ctx(),
    );
    expect(out.result).toMatchObject({ status: "error", reason: "crashed" });
  });
});
