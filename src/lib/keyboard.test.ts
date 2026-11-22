import { describe, expect, it } from "vitest";
import { isEditableTarget } from "./keyboard";

describe("isEditableTarget", () => {
  it("recognises text entry elements", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true);
    }
    const div = document.createElement("div");
    expect(isEditableTarget(div)).toBe(false);
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isEditableTarget(div)).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});
