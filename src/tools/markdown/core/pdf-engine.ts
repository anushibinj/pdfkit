import type { PageSetup } from "../messages";

/**
 * Anything that can lay out an HTML document (with its `<style>` CSS) into
 * PDF bytes.
 *
 * The converter depends on this abstraction, not on a concrete library, so the
 * engine can be swapped (or faked in tests) without touching the Markdown or
 * HTML code.
 */
export interface PdfEngine {
  /**
   * Render a complete HTML document to a PDF.
   *
   * @param html A full HTML document, including `<style>` elements.
   * @param page Paper size and margins. Assumed already normalised.
   * @returns The PDF file's bytes.
   */
  render(html: string, page: PageSetup): Uint8Array;
}
