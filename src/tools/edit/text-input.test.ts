import { describe, expect, it, vi } from "vitest";
import { fakeMetrics } from "./test-utils/fake-metrics";
import { cleanTypedText } from "./text-input";

const warning = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { warning } }));

describe("cleanTypedText", () => {
  it("normalises line breaks and tabs without complaint", () => {
    expect(cleanTypedText("a\r\nb\tc", "sans", fakeMetrics)).toBe("a\nb    c");
    expect(warning).not.toHaveBeenCalled();
  });

  it("removes unwritable characters and says which", () => {
    expect(cleanTypedText("Pay ₹5 ₹ €", "sans", fakeMetrics)).toBe("Pay 5  ");
    expect(warning).toHaveBeenCalledWith(
      "Removed ₹ €: the standard PDF fonts cannot show these characters.",
    );
    cleanTypedText("₹", "sans", fakeMetrics);
    expect(warning).toHaveBeenLastCalledWith(
      "Removed ₹: the standard PDF fonts cannot show this character.",
    );
  });
});
