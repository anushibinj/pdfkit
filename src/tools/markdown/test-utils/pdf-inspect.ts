/**
 * Test-only helpers that look inside generated PDFs. Node only (uses zlib).
 */
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

/**
 * Load a PDF with pdf-lib and return each page's size in points.
 *
 * @param bytes A PDF file.
 * @returns One `{ width, height }` per page, rounded to whole points.
 */
export async function pageSizes(
  bytes: Uint8Array,
): Promise<{ width: number; height: number }[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width: Math.round(width), height: Math.round(height) };
  });
}

/**
 * Concatenate every stream in the file, inflating the Flate-compressed ones.
 *
 * It scans the raw bytes for `stream` ... `endstream` pairs instead of walking
 * the object graph: crude, but enough to search drawing operators such as
 * `1 0 0 rg` (set fill colour to red) in tests. Streams that are not
 * zlib-compressed (or are images) are kept as-is.
 *
 * @param bytes A PDF file.
 * @returns All stream contents as one latin1 string.
 */
export function allStreamText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const parts: string[] = [];
  const start = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(raw))) {
    const from = m.index + m[0].length;
    const to = raw.indexOf("endstream", from);
    if (to < 0) break;
    // The end-of-line before "endstream" is not part of the data.
    const body = Buffer.from(
      raw.slice(from, to).replace(/\r?\n$/, ""),
      "latin1",
    );
    try {
      parts.push(inflateSync(body).toString("latin1"));
    } catch {
      parts.push(body.toString("latin1"));
    }
    // Skip past "endstream" itself, otherwise the "stream" inside it would
    // match next and swallow the following object.
    start.lastIndex = to + "endstream".length;
  }
  return parts.join("\n");
}
