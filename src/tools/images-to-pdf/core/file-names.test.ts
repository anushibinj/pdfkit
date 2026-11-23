import { describe, expect, it } from "vitest";
import { outputPdfName } from "./file-names";

describe("outputPdfName", () => {
  it("replaces png, jpg, and jpeg extensions for a single image", () => {
    expect(outputPdfName(["receipt.png"])).toBe("receipt.pdf");
    expect(outputPdfName(["photo.JPG"])).toBe("photo.pdf");
    expect(outputPdfName(["scan.jpeg"])).toBe("scan.pdf");
  });

  it("falls back to document.pdf when the stripped single name is blank", () => {
    expect(outputPdfName(["  .png"])).toBe("document.pdf");
  });

  it("returns images.pdf for multiple images or an empty list", () => {
    expect(outputPdfName(["a.png", "b.jpg"])).toBe("images.pdf");
    expect(outputPdfName([])).toBe("images.pdf");
  });
});
