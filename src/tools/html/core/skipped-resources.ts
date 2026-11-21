/**
 * Find what in an HTML document the PDF engine will leave out, so the page
 * can say so instead of silently producing an incomplete PDF.
 *
 * ironpress (in WebAssembly, inside our worker) has no network and no file
 * system access, and no JavaScript engine. Checked against ironpress 1.7.0
 * (see the integration test), it quietly skips:
 * - images whose `src` is not an embedded PNG or JPEG (`data:` URL): web
 *   links, relative paths such as "logo.png", `file:` URLs, and GIF, WebP or
 *   SVG images even when embedded;
 * - every `<link rel="stylesheet">`, even one with a `data:` URL;
 * - every script.
 * The conversion still succeeds, which is exactly why the user has to be told.
 *
 * The document is read with {@link forEachStartTag}, a linear tag scanner,
 * not `DOMParser`: parsing into a DOM makes the browser report Content
 * Security Policy violations for the HTML's inline styles and event handler
 * attributes (see that module for details).
 */
import { forEachStartTag, type StartTag } from "./html-start-tags";

/** How many of each kind of resource the PDF will lack. */
export interface SkippedResources {
  images: number;
  stylesheets: number;
  scripts: number;
}

/** A document that loads nothing the engine would skip. */
export const NO_SKIPPED_RESOURCES: SkippedResources = {
  images: 0,
  stylesheets: 0,
  scripts: 0,
};

/** Embedded image types the engine does not draw (checked with ironpress 1.7.0). */
export const UNSUPPORTED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/**
 * The `type` attribute values that make a `<script>` run as JavaScript (the
 * WHATWG "JavaScript MIME type essence" strings). A browser compares the whole
 * attribute value, so `text/javascript; charset=utf-8` is not one of them and
 * does not run. Any other value is a data block (for example JSON-LD), which
 * browsers do not run either.
 */
const JAVASCRIPT_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

/**
 * Decide whether an image source can be embedded in the PDF.
 *
 * ironpress decodes the bytes of a `data:` URL by their content, not by the
 * declared type (a PNG labelled image/jpeg still works), and it only decodes
 * PNG and JPEG. So the declared type is a hint, not a rule: anything that is
 * not a `data:` URL is skipped, and a `data:` URL is accepted unless it
 * declares one of the types verified not to be drawn (GIF, WebP, SVG; see
 * the integration test). An image whose declared type is wrong may still be
 * missed by this check; the scan is a warning, not a guarantee.
 *
 * @param src The `src` attribute value.
 * @returns `true` when the engine will draw the image.
 */
export function isEmbeddableImageSource(src: string): boolean {
  const value = src.trim().toLowerCase();
  if (!value.startsWith("data:")) return false;
  const type = value.slice("data:".length).split(/[;,]/, 1)[0].trim();
  return !UNSUPPORTED_IMAGE_TYPES.has(type);
}

/**
 * Decide whether a `<script>` would run in a browser, following the HTML
 * standard's "prepare the script element" rules for its type:
 * - no `type` (or an empty one) and no non-empty `language`: JavaScript;
 * - no `type` but `language="x"`: the type is "text/x";
 * - otherwise the trimmed, lowercased `type` must be a JavaScript type or
 *   "module".
 * Scripts with neither a `src` nor any code are ignored: they do nothing.
 *
 * @param script A `<script>` start tag from {@link forEachStartTag}.
 * @returns `true` when a browser would run it.
 */
export function isRunnableScript(script: StartTag): boolean {
  const { attributes } = script;
  if (!attributes.has("src") && (script.text ?? "").trim() === "") {
    return false;
  }
  const type = attributes.get("type");
  const language = attributes.get("language");
  let typeString: string;
  if (type === "" || (type === undefined && !language)) {
    typeString = "text/javascript";
  } else if (type === undefined) {
    typeString = `text/${language}`;
  } else {
    typeString = type.trim();
  }
  const lowered = typeString.toLowerCase();
  return JAVASCRIPT_TYPES.has(lowered) || lowered === "module";
}

/**
 * Decide whether a `<link>` loads a stylesheet a browser would apply:
 * its `rel` contains the token "stylesheet" but not "alternate" (alternate
 * stylesheets are off until the reader picks one).
 *
 * @param link A `<link>` start tag from {@link forEachStartTag}.
 * @returns `true` for an applied external stylesheet.
 */
export function isStylesheetLink(link: StartTag): boolean {
  const tokens = (link.attributes.get("rel") ?? "")
    .toLowerCase()
    .split(/[\t\n\f\r ]+/);
  return tokens.includes("stylesheet") && !tokens.includes("alternate");
}

/**
 * Decide whether an `<img>` start tag is an image the engine leaves out.
 *
 * An `<img>` with neither `src` nor `srcset` is not counted: it shows
 * nothing in a browser either. One with only `srcset` is counted, because
 * the engine reads `src` alone.
 *
 * @param img An `<img>` start tag from {@link forEachStartTag}.
 * @returns `true` when the PDF will lack this image.
 */
export function isSkippedImage(img: StartTag): boolean {
  const src = img.attributes.get("src") ?? "";
  const hasSource = src.trim() !== "" || img.attributes.has("srcset");
  return hasSource && !isEmbeddableImageSource(src);
}

/**
 * Count what the engine will leave out of an HTML document.
 *
 * @param html The HTML being converted.
 * @returns The counts.
 */
export function scanHtmlForSkippedResources(html: string): SkippedResources {
  const counts = { images: 0, stylesheets: 0, scripts: 0 };
  forEachStartTag(html, (tag) => {
    if (tag.name === "img" && isSkippedImage(tag)) counts.images++;
    else if (tag.name === "link" && isStylesheetLink(tag)) counts.stylesheets++;
    else if (tag.name === "script" && isRunnableScript(tag)) counts.scripts++;
  });
  return counts;
}

/**
 * Pick the singular or plural form for a count.
 *
 * @param count How many.
 * @param one The phrase for exactly one, e.g. "image was".
 * @param many The phrase for other counts, e.g. "images were".
 * @returns For example "1 image was" or "3 images were".
 */
export function countPhrase(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Explain the counts in plain sentences, one per kind, each saying what was
 * left out and what to do instead.
 *
 * @param skipped The counts.
 * @returns The sentences, empty when nothing was left out.
 */
export function describeSkippedResources(skipped: SkippedResources): string[] {
  const lines: string[] = [];
  if (skipped.images > 0) {
    lines.push(
      `${countPhrase(skipped.images, "image was", "images were")} left out. Only PNG and JPEG images embedded in the HTML as data: URLs are included, not links to the web or to files on your computer.`,
    );
  }
  if (skipped.stylesheets > 0) {
    lines.push(
      `${countPhrase(skipped.stylesheets, "linked stylesheet was", "linked stylesheets were")} left out. Put the CSS in a <style> element instead.`,
    );
  }
  if (skipped.scripts > 0) {
    lines.push(
      `${countPhrase(skipped.scripts, "script was", "scripts were")} not run, so anything they would add to the page is missing.`,
    );
  }
  return lines;
}
