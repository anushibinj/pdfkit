/** Extensions accepted by the "open a Markdown file" picker. */
const MARKDOWN_EXTENSION = /\.(md|markdown|mdown|mkd|txt)$/i;

/** Value for the file input's `accept` attribute. */
export const MARKDOWN_ACCEPT =
  ".md,.markdown,.mdown,.mkd,.txt,text/markdown,text/x-markdown,text/plain";

/**
 * Decide whether a picked or dropped file is a Markdown (or plain text) file.
 *
 * The extension is checked first. The MIME type is only a fallback, because
 * browsers report `.md` inconsistently: often as an empty string, sometimes as
 * `text/markdown` or `text/x-markdown`.
 *
 * @param file Anything with a `name` and a `type`, such as a `File`.
 * @returns `true` for Markdown and plain text files.
 */
export function isMarkdownFile(file: { name: string; type: string }): boolean {
  return (
    MARKDOWN_EXTENSION.test(file.name) ||
    file.type === "text/markdown" ||
    file.type === "text/x-markdown" ||
    file.type === "text/plain"
  );
}

/**
 * Pick the download name for the generated PDF.
 *
 * "notes.md" becomes "notes.pdf". A name without a recognised extension keeps
 * its full text. With no source file (text typed into the editor), or a name
 * that is empty after trimming, the result is "document.pdf".
 *
 * @param sourceName The opened file's name, if any.
 * @returns A file name ending in ".pdf".
 */
export function pdfNameForMarkdown(sourceName?: string): string {
  const base = (sourceName ?? "").replace(MARKDOWN_EXTENSION, "").trim();
  return `${base || "document"}.pdf`;
}
