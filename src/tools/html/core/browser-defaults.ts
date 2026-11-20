/**
 * Browser default rules that ironpress does not apply by itself.
 *
 * Every browser ships a "user agent stylesheet". ironpress implements most of
 * it, but (checked against ironpress 1.7.0, see the integration test) it
 * draws three kinds of content that a browser keeps hidden:
 *
 * 1. Elements with the `hidden` attribute. Hiding them matters for privacy as
 *    well as looks: pages often keep text in `hidden` elements that was never
 *    meant to be seen, and it must not appear in the PDF.
 * 2. The body of a closed `<details>` element. A browser shows only its first
 *    `<summary>` child.
 * 3. A `<dialog>` without the `open` attribute. ironpress ignores
 *    `display: none` on the dialog element itself, so the rule hides the
 *    dialog's children instead, which has the same visible result.
 *
 * Every selector is wrapped in `:where()`, which gives it a specificity of
 * zero. The document's own rules therefore still win, as they do against a
 * browser's defaults: a page that says `p { display: block }` shows its
 * `<p hidden>` in a browser too, and so it does in the PDF.
 *
 * Known gap: text directly inside a closed `<details>` (not wrapped in an
 * element) cannot be selected by CSS, so it stays visible.
 */
export const BROWSER_DEFAULTS_CSS = [
  ":where([hidden]) { display: none; }",
  ":where(details:not([open]) > :not(summary:first-of-type)) { display: none; }",
  ":where(dialog:not([open]) > *) { display: none; }",
].join("\n");

/** The `<style>` element that {@link withBrowserDefaults} inserts. */
export const BROWSER_DEFAULTS_STYLE = `<style>${BROWSER_DEFAULTS_CSS}</style>`;

/** ASCII whitespace as the HTML tokenizer defines it (tab, LF, FF, CR, space). */
function isHtmlWhitespace(char: string): boolean {
  return (
    char === "\t" ||
    char === "\n" ||
    char === "\f" ||
    char === "\r" ||
    char === " "
  );
}

/**
 * Find where a document's leading `<!doctype ...>` ends.
 *
 * The HTML parser accepts a byte order mark, whitespace, comments and XML
 * processing instructions (such as `<?xml version="1.0"?>`, which it reads as
 * a comment) before the doctype. This walks over exactly those, in one pass:
 *
 * 1. Skip a leading U+FEFF (byte order mark).
 * 2. Repeatedly skip whitespace, `<!-- ... -->` comments and `<? ... >`
 *    instructions. A comment ends at the first `-->` counted from the `<!`,
 *    so `<!-->` is a complete (empty) comment, as the HTML tokenizer has it.
 *    An unterminated comment or instruction means there is no doctype.
 * 3. If what follows is `<!doctype` (any letter case), the doctype ends at
 *    its first `>`, the same place the tokenizer ends it.
 *
 * It deliberately avoids a regular expression: a pattern such as
 * `(?:<!--[\s\S]*?-->)*<!doctype` backtracks exponentially on a document
 * with many comments and no doctype, which would freeze the worker. This
 * loop looks at every character at most a constant number of times.
 *
 * @param html The document text.
 * @returns The index just after the doctype's `>`, or 0 when the document
 *   does not start with a doctype.
 */
export function leadingDoctypeEnd(html: string): number {
  let i = html.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < html.length && isHtmlWhitespace(html[i])) i++;
    if (html.startsWith("<!--", i)) {
      // Search from the "<!" + 2, so the dashes of "<!--" itself can close
      // an empty comment written as "<!-->".
      const close = html.indexOf("-->", i + 2);
      if (close < 0) return 0;
      i = close + 3;
    } else if (html.startsWith("<?", i)) {
      const close = html.indexOf(">", i + 2);
      if (close < 0) return 0;
      i = close + 1;
    } else {
      break;
    }
  }
  if (html.slice(i, i + 9).toLowerCase() !== "<!doctype") return 0;
  const close = html.indexOf(">", i + 9);
  return close < 0 ? 0 : close + 1;
}

/**
 * Insert {@link BROWSER_DEFAULTS_STYLE} into a document.
 *
 * Where it goes matters:
 * - Right after the doctype, not before it. Content before the doctype makes
 *   the parser ignore it, which would switch the document into quirks mode.
 * - At the start (when there is no doctype) rather than at the end. Inserted
 *   at the end, an unclosed `<textarea>`, `<title>` or comment in the user's
 *   HTML would swallow the `<style>` element as text, and the CSS would be
 *   drawn on the page instead of applied.
 * A `<style>` before `<html>`/`<head>` is valid input: the parser creates the
 * `<head>` for it and merges the document's own `<html lang>` attributes into
 * the same element, so nothing about the document changes.
 *
 * @param html A complete document or a fragment.
 * @returns The same HTML with the browser default rules added.
 */
export function withBrowserDefaults(html: string): string {
  const at = leadingDoctypeEnd(html);
  return html.slice(0, at) + BROWSER_DEFAULTS_STYLE + html.slice(at);
}
