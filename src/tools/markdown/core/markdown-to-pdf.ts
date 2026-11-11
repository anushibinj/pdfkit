import type { ConvertRequest } from "../messages";
import { buildHtmlDocument } from "./html-document";
import type { MarkdownRenderer } from "./markdown-renderer";
import { normalizePageSetup } from "./page-setup";
import type { PdfEngine } from "./pdf-engine";

/**
 * Orchestrates one conversion: Markdown -> HTML fragment -> styled HTML
 * document -> PDF.
 *
 * Each step is owned by a collaborator injected through the constructor
 * (Markdown parsing by a {@link MarkdownRenderer}, layout by a
 * {@link PdfEngine}). This class only decides the order, so either side can
 * be replaced, or faked in tests, without editing it.
 */
export class MarkdownToPdfConverter {
  /**
   * @param renderer Turns Markdown into an HTML fragment.
   * @param engine Lays the styled HTML out into PDF pages.
   */
  constructor(
    private readonly renderer: MarkdownRenderer,
    private readonly engine: PdfEngine,
  ) {}

  /**
   * Convert one request into PDF bytes.
   *
   * The page settings are normalised first because the request crosses a
   * thread boundary and could carry anything (see `normalizePageSetup`).
   * A `css` value that is not a string is treated as empty for the same
   * reason, rather than letting `undefined` be written into the document.
   *
   * @param request Markdown, CSS and page settings.
   * @returns The PDF file's bytes.
   * @throws Whatever the renderer or engine throws (handled by the worker).
   */
  convert(request: ConvertRequest): Uint8Array {
    const page = normalizePageSetup(request.page);
    const css = typeof request.css === "string" ? request.css : "";
    const bodyHtml = this.renderer.render(request.markdown);
    const html = buildHtmlDocument({ css, bodyHtml });
    return this.engine.render(html, page);
  }
}
