import { describe, expect, it } from "vitest";
import { isQuarterTurns } from "./page-types";

describe("isQuarterTurns", () => {
  it.each([0, 1, 2, 3])("accepts %d", (n) => {
    expect(isQuarterTurns(n)).toBe(true);
  });
  it.each([4, -1, 1.5, "1", null, undefined])("rejects %j", (v) => {
    expect(isQuarterTurns(v)).toBe(false);
  });
});
