import { describe, expect, it } from "vitest";
import { InvalidOutputPlanError } from "../core/output-plan";
import { toErrorResult } from "./error-result";

describe("toErrorResult", () => {
  it("reports memory exhaustion with what was happening", () => {
    expect(toErrorResult(new RangeError("x"), "building the PDF")).toEqual({
      status: "error",
      reason: "out-of-memory",
      message:
        "The browser ran out of memory while building the PDF. Close other tabs, or try smaller files.",
    });
  });

  it("marks an engine trap as a crash", () => {
    const trap = new WebAssembly.RuntimeError("unreachable");
    expect(toErrorResult(trap, "drawing a page")).toMatchObject({
      reason: "crashed",
      message: expect.stringContaining("unreachable"),
    });
  });

  it("words a rejected plan as such", () => {
    expect(
      toErrorResult(new InvalidOutputPlanError("page 2 is bad"), "x"),
    ).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not build the PDF: page 2 is bad",
    });
  });

  it("passes anything else on as an ordinary failure", () => {
    expect(toErrorResult(new Error("nope"), "x")).toEqual({
      status: "error",
      reason: "failed",
      message: "nope",
    });
    expect(toErrorResult("plain string", "x")).toMatchObject({
      message: "plain string",
    });
  });
});
