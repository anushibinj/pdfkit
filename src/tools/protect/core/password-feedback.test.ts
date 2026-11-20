import { describe, expect, it } from "vitest";
import { passwordFeedback } from "./password-feedback";

describe("passwordFeedback", () => {
  it("shows nothing for empty fields", () => {
    expect(passwordFeedback("", "")).toEqual({
      confirmationError: undefined,
      compatibilityWarning: false,
    });
  });

  it("shows nothing while the confirmation is being typed correctly", () => {
    for (const partial of ["h", "hun", "hunter"]) {
      expect(
        passwordFeedback("hunter2", partial).confirmationError,
      ).toBeUndefined();
    }
    expect(
      passwordFeedback("hunter2", "hunter2").confirmationError,
    ).toBeUndefined();
  });

  it("flags a mismatch as soon as the confirmation diverges", () => {
    expect(passwordFeedback("hunter2", "hx").confirmationError).toBe(
      "The passwords do not match.",
    );
  });

  it("flags a confirmation that is complete but different", () => {
    expect(passwordFeedback("hunter2", "hunter2!").confirmationError).toBe(
      "The passwords do not match.",
    );
  });

  it("flags a confirmation typed before the password", () => {
    expect(passwordFeedback("", "abc").confirmationError).toBe(
      "The passwords do not match.",
    );
  });

  it("shows the password's own problem instead of a mismatch", () => {
    expect(passwordFeedback("x".repeat(128), "y")).toEqual({
      passwordError: expect.stringContaining("too long"),
      compatibilityWarning: false,
    });
    expect(passwordFeedback("a\u0000", "").passwordError).toMatch(
      /control character/,
    );
  });

  it("warns about characters some readers convert, for a valid password", () => {
    expect(passwordFeedback("pass²", "").compatibilityWarning).toBe(true);
    expect(passwordFeedback("plain", "").compatibilityWarning).toBe(false);
  });
});
