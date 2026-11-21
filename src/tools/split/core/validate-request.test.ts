import { describe, expect, it } from "vitest";
import {
  InvalidRequestError,
  MAX_OUTPUTS,
  MAX_TOTAL_PAGES,
  validateOutputs,
} from "./validate-request";

describe("validateOutputs", () => {
  it("accepts a valid plan and returns copies", () => {
    const outputs = [[0, 1], [2]];
    const result = validateOutputs(3, outputs);
    expect(result).toEqual({ pageCount: 3, outputs: [[0, 1], [2]] });
    expect(result.outputs).not.toBe(outputs);
    expect(result.outputs[0]).not.toBe(outputs[0]);
  });

  it.each([0, -1, 1.5, "3", null, undefined])(
    "rejects the page count %j",
    (count) => {
      expect(() => validateOutputs(count, [[0]])).toThrow(/page count/);
    },
  );

  it.each([[[]], [null], ["x"], [{}]])("rejects outputs %j", (outputs) => {
    expect(() => validateOutputs(3, outputs)).toThrow(InvalidRequestError);
  });

  it("rejects an output without pages", () => {
    expect(() => validateOutputs(3, [[0], []])).toThrow("File 2 has no pages.");
    expect(() => validateOutputs(3, [[0], "1"])).toThrow("File 2 has no pages.");
  });

  it.each([[[3]], [[-1]], [[0.5]], [["0"]], [[null]]])(
    "rejects pages that do not exist: %j",
    (pages) => {
      expect(() => validateOutputs(3, [pages])).toThrow(
        "File 1 lists a page that does not exist.",
      );
    },
  );

  it("refuses more files than a ZIP can hold", () => {
    const outputs = Array.from({ length: MAX_OUTPUTS + 1 }, () => [0]);
    expect(() => validateOutputs(1, outputs)).toThrow(/at most 65535/);
  });

  it("refuses runaway page totals", () => {
    const big = Array.from({ length: 1000 }, (_, i) => i);
    const outputs = Array.from(
      { length: MAX_TOTAL_PAGES / 1000 + 1 },
      () => big,
    );
    expect(() => validateOutputs(1000, outputs)).toThrow(/too many pages/);
  });
});
