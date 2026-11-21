import { pdfFileNameFor } from "@/lib/format";

/** Extensions accepted by the "open an HTML file" picker: .html .htm .xhtml .xht */
const HTML_EXTENSION = /\.(html?|xht(ml)?)$/i;

/** Value for the file input's `accept` attribute. */
export const HTML_ACCEPT =
  ".html,.htm,.xhtml,.xht,text/html,application/xhtml+xml";

/**
 * Decide whether a picked or dropped file is an HTML file.
 *
 * The extension is checked first and the MIME type is a fallback, because
 * the type a browser reports depends on the operating system's file
 * associations (it can be empty).
 *
 * @param file Anything with a `name` and a `type`, such as a `File`.
 * @returns `true` for HTML and XHTML files.
 */
export function isHtmlFile(file: { name: string; type: string }): boolean {
  return (
    HTML_EXTENSION.test(file.name) ||
    file.type === "text/html" ||
    file.type === "application/xhtml+xml"
  );
}

/**
 * Pick the download name for the generated PDF: "invoice.html" becomes
 * "invoice.pdf", and HTML typed into the editor becomes "document.pdf".
 *
 * @param sourceName The opened file's name, if any.
 * @returns A file name ending in ".pdf".
 */
export function pdfNameForHtml(sourceName?: string): string {
  return pdfFileNameFor(sourceName, HTML_EXTENSION);
}
