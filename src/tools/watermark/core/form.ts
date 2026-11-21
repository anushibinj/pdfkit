import {
  DEFAULT_IMAGE_SCALE,
  DEFAULT_SETTINGS,
  DEFAULT_TEXT_CONTENT,
  type Layer,
  type Position,
  type TextContent,
  type WatermarkSettings,
} from "./model";
import { parsePageRanges } from "./page-ranges";
import { InvalidSettingsError, sanitizeTextContent } from "./sanitize-settings";

/** A picture the user picked, checked and kept in memory. */
export interface PickedImage {
  name: string;
  /** The file's bytes (copied to the worker with each request). */
  bytes: ArrayBuffer;
}

/**
 * Everything the settings form shows. Text and picture settings are both
 * kept, so switching between "Text" and "Picture" never loses what the
 * user typed or picked.
 */
export interface WatermarkForm {
  kind: "text" | "image";
  text: Omit<TextContent, "kind">;
  image: PickedImage | null;
  /** Picture width as a fraction of the page width. */
  imageScale: number;
  opacity: number;
  rotation: number;
  position: Position;
  layer: Layer;
  /** Page range text as typed ("" = all pages). */
  pages: string;
}

/** The form a session starts with (see `DEFAULT_SETTINGS`). */
export const DEFAULT_FORM: WatermarkForm = {
  kind: "text",
  text: {
    text: DEFAULT_TEXT_CONTENT.text,
    font: DEFAULT_TEXT_CONTENT.font,
    bold: DEFAULT_TEXT_CONTENT.bold,
    fontSize: DEFAULT_TEXT_CONTENT.fontSize,
    color: DEFAULT_TEXT_CONTENT.color,
  },
  image: null,
  imageScale: DEFAULT_IMAGE_SCALE,
  opacity: DEFAULT_SETTINGS.opacity,
  rotation: DEFAULT_SETTINGS.rotation,
  position: DEFAULT_SETTINGS.position,
  layer: DEFAULT_SETTINGS.layer,
  pages: "",
};

/** Which field a problem belongs to, so the UI can show it there. */
export type FormField = "text" | "image" | "pages";

/** Outcome of {@link checkForm}. */
export type FormCheck =
  | { ok: true; settings: WatermarkSettings; pages: number[] }
  | { ok: false; field: FormField; message: string };

/**
 * Check the form and turn it into worker settings and page indices.
 *
 * The text is checked with the worker's own `sanitizeTextContent`, so the
 * form refuses exactly what the worker would refuse (empty text, too long,
 * characters the standard fonts cannot write) and shows it next to the
 * field instead of as a failed download.
 *
 * @param form The form.
 * @param pageCount Pages in the open PDF (for the page range).
 * @returns Settings and pages, or the first problem found.
 */
export function checkForm(form: WatermarkForm, pageCount: number): FormCheck {
  let content: WatermarkSettings["content"];
  if (form.kind === "text") {
    const problem = textProblem(form.text);
    if (problem) return { ok: false, field: "text", message: problem };
    content = { kind: "text", ...form.text };
  } else {
    if (!form.image)
      return { ok: false, field: "image", message: "Choose a picture." };
    content = {
      kind: "image",
      bytes: form.image.bytes,
      scale: form.imageScale,
    };
  }
  const pages = parsePageRanges(form.pages, pageCount);
  if (!pages.ok) return { ok: false, field: "pages", message: pages.error };
  return {
    ok: true,
    pages: pages.pages,
    settings: {
      content,
      opacity: form.opacity,
      rotation: form.rotation,
      position: form.position,
      layer: form.layer,
    },
  };
}

/**
 * Why the watermark text cannot be used, if it cannot.
 *
 * @param text The text settings.
 * @returns The worker's message, or `null` when the text is fine.
 */
export function textProblem(text: Omit<TextContent, "kind">): string | null {
  try {
    sanitizeTextContent({ kind: "text", ...text });
    return null;
  } catch (err) {
    if (err instanceof InvalidSettingsError) return err.message;
    throw err;
  }
}

/**
 * The settings for previewing one page: the watermark when the form is
 * valid and the page is among the selected ones; nothing otherwise, so
 * the preview shows the page as the download will have it.
 *
 * @param check The form's check.
 * @param pageIndex The page shown.
 * @returns Settings, or `undefined` for the page without a watermark.
 */
export function previewSettings(
  check: FormCheck,
  pageIndex: number,
): WatermarkSettings | undefined {
  return check.ok && check.pages.includes(pageIndex)
    ? check.settings
    : undefined;
}
