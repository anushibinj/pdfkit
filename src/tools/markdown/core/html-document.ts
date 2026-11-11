/**
 * Make CSS safe to place inside a `<style>` element.
 *
 * Why this is needed: `<style>` is a "raw text" element in HTML. The parser
 * does not understand CSS; it simply looks for the first `</style` (in any
 * letter case) and ends the element there. A stylesheet containing, say,
 * `content: "</style><h1>Hi</h1>"` would otherwise close the element early and
 * turn the rest of the CSS into document content.
 *
 * The fix: rewrite every `</style` as `<\/style`. To the HTML parser that is no
 * longer an end tag. To the CSS parser `\/` is an escaped slash, which means
 * exactly `/`, so a string such as `"</style>"` keeps its value. Outside of
 * strings the sequence was never valid CSS anyway, so nothing that worked
 * before changes meaning.
 *
 * @param css Untrusted stylesheet text.
 * @returns The same stylesheet, unable to end its `<style>` element.
 */
export function escapeStyleContent(css: string): string {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}

/** Inputs for {@link buildHtmlDocument}. */
export interface HtmlDocumentParts {
  /** Stylesheet text, placed in a `<style>` element in `<head>` */
  css: string;
  /** Rendered Markdown, placed inside `<body>` */
  bodyHtml: string;
}

/**
 * Assemble a complete HTML5 document from a stylesheet and a body fragment.
 *
 * `<meta charset="utf-8">` comes first so non-ASCII text (accents, Greek,
 * Cyrillic, Arabic, ...) is read correctly by the layout engine. The body is
 * inserted as-is: it is HTML produced by the Markdown renderer and is
 * sanitised later by the PDF engine.
 *
 * @param parts The stylesheet and the body HTML.
 * @returns A full `<!doctype html>` document.
 */
export function buildHtmlDocument({
  css,
  bodyHtml,
}: HtmlDocumentParts): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<style>${escapeStyleContent(css)}</style>`,
    "</head>",
    `<body>${bodyHtml}</body>`,
    "</html>",
  ].join("\n");
}
