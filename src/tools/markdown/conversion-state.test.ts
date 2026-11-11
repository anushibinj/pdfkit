import { describe, expect, it } from "vitest";
import {
  INITIAL_CONVERSION_STATE,
  conversionReducer,
  type ConversionState,
} from "./conversion-state";

const pdf = new Blob(["%PDF"], { type: "application/pdf" });
const converting: ConversionState = { kind: "converting" };
const done: ConversionState = { kind: "done", pdf };
const error: ConversionState = {
  kind: "error",
  reason: "failed",
  message: "x",
};

describe("conversionReducer", () => {
  it("starts from idle", () => {
    expect(INITIAL_CONVERSION_STATE).toEqual({ kind: "idle" });
  });

  it("start: begins converting from any settled state", () => {
    for (const s of [INITIAL_CONVERSION_STATE, done, error]) {
      expect(conversionReducer(s, { type: "start" })).toEqual(converting);
    }
  });

  it("start: is ignored while already converting", () => {
    expect(conversionReducer(converting, { type: "start" })).toBe(converting);
  });

  it("succeed: stores the PDF only while converting", () => {
    expect(conversionReducer(converting, { type: "succeed", pdf })).toEqual(
      done,
    );
    expect(
      conversionReducer(INITIAL_CONVERSION_STATE, { type: "succeed", pdf }),
    ).toBe(INITIAL_CONVERSION_STATE);
  });

  it("fail: stores the error only while converting", () => {
    const action = {
      type: "fail",
      reason: "out-of-memory",
      message: "oom",
    } as const;
    expect(conversionReducer(converting, action)).toEqual({
      kind: "error",
      reason: "out-of-memory",
      message: "oom",
    });
    expect(conversionReducer(done, action)).toBe(done);
  });

  it("cancel: returns to idle only while converting", () => {
    expect(conversionReducer(converting, { type: "cancel" })).toEqual({
      kind: "idle",
    });
    expect(conversionReducer(done, { type: "cancel" })).toBe(done);
  });

  it("input-changed: drops stale results and errors", () => {
    expect(conversionReducer(done, { type: "input-changed" })).toEqual({
      kind: "idle",
    });
    expect(conversionReducer(error, { type: "input-changed" })).toEqual({
      kind: "idle",
    });
    expect(conversionReducer(converting, { type: "input-changed" })).toBe(
      converting,
    );
    expect(
      conversionReducer(INITIAL_CONVERSION_STATE, { type: "input-changed" }),
    ).toBe(INITIAL_CONVERSION_STATE);
  });
});
