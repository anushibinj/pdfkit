import { describe, expect, it } from "vitest";
import { toErrorResult } from "./error-result";

describe("toErrorResult", () => {
  it("classifies memory exhaustion with the task in the message", () => {
    expect(
      toErrorResult(new RangeError("Array buffer allocation failed"), "making the files"),
    ).toEqual({
      status: "error",
      reason: "out-of-memory",
      message: expect.stringContaining("ran out of memory while making the files"),
    });
  });

  it("classifies WebAssembly traps as crashes", () => {
    const result = toErrorResult(new WebAssembly.RuntimeError("unreachable"), "x");
    expect(result.reason).toBe("crashed");
    expect(result.message).toContain("unreachable");
  });

  it("passes other errors and thrown strings through as failures", () => {
    expect(toErrorResult(new Error("nope"), "x")).toEqual({
      status: "error",
      reason: "failed",
      message: "nope",
    });
    expect(toErrorResult("plain string", "x").message).toBe("plain string");
  });
});
