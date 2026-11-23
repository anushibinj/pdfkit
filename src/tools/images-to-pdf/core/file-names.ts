import { pdfFileNameFor } from "@/lib/format";

/** Extensions stripped when naming a single-image PDF output. */
const IMAGE_EXTENSIONS = /\.(png|jpe?g)$/i;

/**
 * Derive the download filename for the generated PDF.
 *
 * - Single image: replaces its `.png`/`.jpg`/`.jpeg` extension with `.pdf`
 *   (e.g. `"scan-01.jpg"` -> `"scan-01.pdf"`).
 * - Multiple images (or empty list): returns `"images.pdf"`, matching the
 *   concise multi-file naming convention used by Organize Pages.
 *
 * @param names The source image filenames in page order.
 * @returns A filename ending in `".pdf"`.
 */
export function outputPdfName(names: readonly string[]): string {
  if (names.length === 1) {
    return pdfFileNameFor(names[0], IMAGE_EXTENSIONS);
  }
  return "images.pdf";
}
