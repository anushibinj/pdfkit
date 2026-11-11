import { describe, expect, it } from "vitest";
import { errorMessage, isOutOfMemory } from "./errors";

describe("isOutOfMemory", () => {
  it("treats every RangeError as out of memory", () => {
    expect(isOutOfMemory(new RangeError("Invalid array length"))).toBe(true);
  });

  it.each([
    "out of memory",
    "memory access out of bounds",
    "Cannot enlarge memory arrays",
    "Array buffer allocation failed",
    "Aborted(OOM)",
  ])("recognises %j", (message) => {
    expect(isOutOfMemory(new Error(message))).toBe(true);
    // wasm-bindgen throws plain strings, not Error objects
    expect(isOutOfMemory(message)).toBe(true);
  });

  it("does not flag unrelated failures", () => {
    expect(isOutOfMemory(new Error("invalid password"))).toBe(false);
    expect(isOutOfMemory(undefined)).toBe(false);
  });
});

describe("errorMessage", () => {
  it("returns an Error's message", () => {
    expect(errorMessage(new TypeError("boom"))).toBe("boom");
  });

  it("stringifies non-Error values", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
  });
});
