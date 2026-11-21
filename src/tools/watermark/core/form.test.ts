import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORM,
  checkForm,
  previewSettings,
  textProblem,
  type WatermarkForm,
} from "./form";
import { DEFAULT_SETTINGS } from "./model";

const form = (patch: Partial<WatermarkForm> = {}): WatermarkForm => ({
  ...DEFAULT_FORM,
  ...patch,
});

describe("DEFAULT_FORM", () => {
  it("turns into the default settings", () => {
    expect(checkForm(DEFAULT_FORM, 2)).toEqual({
      ok: true,
      pages: [0, 1],
      settings: DEFAULT_SETTINGS,
    });
  });
});

describe("textProblem", () => {
  it("accepts usable text and explains unusable text", () => {
    expect(textProblem(DEFAULT_FORM.text)).toBeNull();
    expect(textProblem({ ...DEFAULT_FORM.text, text: " " })).toBe(
      "Type the watermark text.",
    );
    expect(textProblem({ ...DEFAULT_FORM.text, text: "₹" })).toMatch(
      /standard PDF fonts: ₹/,
    );
  });
});

describe("checkForm", () => {
  it("reports a text problem on the text field", () => {
    expect(
      checkForm(form({ text: { ...DEFAULT_FORM.text, text: "" } }), 1),
    ).toEqual({
      ok: false,
      field: "text",
      message: "Type the watermark text.",
    });
  });

  it("asks for a picture before one is chosen", () => {
    expect(checkForm(form({ kind: "image" }), 1)).toEqual({
      ok: false,
      field: "image",
      message: "Choose a picture.",
    });
  });

  it("builds picture settings from the picked image and scale", () => {
    const bytes = new ArrayBuffer(4);
    const result = checkForm(
      form({
        kind: "image",
        image: { name: "logo.png", bytes },
        imageScale: 0.25,
      }),
      1,
    );
    expect(result).toMatchObject({
      ok: true,
      settings: { content: { kind: "image", bytes, scale: 0.25 } },
    });
  });

  it("keeps the typed text while a picture is shown", () => {
    const showingPicture = form({
      kind: "image",
      text: { ...DEFAULT_FORM.text, text: "DRAFT" },
    });
    expect(checkForm({ ...showingPicture, kind: "text" }, 1)).toMatchObject({
      ok: true,
      settings: { content: { kind: "text", text: "DRAFT" } },
    });
  });

  it("reports a page range problem on the pages field", () => {
    expect(checkForm(form({ pages: "9" }), 3)).toEqual({
      ok: false,
      field: "pages",
      message: "There is no page 9: this PDF has 3 pages.",
    });
  });
});

describe("previewSettings", () => {
  it("shows the watermark only on selected pages of a valid form", () => {
    const check = checkForm(form({ pages: "2" }), 3);
    expect(previewSettings(check, 1)).toEqual(DEFAULT_SETTINGS);
    expect(previewSettings(check, 0)).toBeUndefined();
    expect(
      previewSettings(checkForm(form({ pages: "x" }), 3), 1),
    ).toBeUndefined();
  });
});
