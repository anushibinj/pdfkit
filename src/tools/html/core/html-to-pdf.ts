import type { Converter } from "@/lib/html-pdf/convert-handler";
import { normalizePageSetup } from "@/lib/html-pdf/page-setup";
import type { PdfEngine } from "@/lib/html-pdf/pdf-engine";
import type { HtmlConvertRequest } from "../messages";
import { withBrowserDefaults } from "./browser-defaults";

/** Rewrites the user's HTML before layout, e.g. to add default rules. */
export type HtmlPreparer = (html: string) => string;

/**
 * Orchestrates one conversion: user HTML -> prepared HTML -> PDF.
 *
 * Both steps are injected: preparing the document ({@link HtmlPreparer},
 * by default {@link withBrowserDefaults}) and laying it out
 * ({@link PdfEngine}). This class only decides the order and guards the
 * input, so the engine can be replaced, or faked in tests, without editing it.
 */
export class HtmlToPdfConverter implements Converter<HtmlConvertRequest> {
  /**
   * @param engine Lays the HTML out into PDF pages.
   * @param prepare Rewrites the HTML first; defaults to adding the browser
   *   default rules that the engine lacks.
   */
  constructor(
    private readonly engine: PdfEngine,
    private readonly prepare: HtmlPreparer = withBrowserDefaults,
  ) {}

  /**
   * Convert one request into PDF bytes.
   *
   * The request crossed a thread boundary and could carry anything, so the
   * page settings are normalised (see `normalizePageSetup`) and an `html`
   * value that is not a string is treated as an empty document rather than
   * letting "undefined" be laid out as text.
   *
   * @param request The HTML and the page settings.
   * @returns The PDF file's bytes.
   * @throws Whatever the engine throws (classified by the worker).
   */
  convert(request: HtmlConvertRequest): Uint8Array {
    const page = normalizePageSetup(request.page);
    const html = typeof request.html === "string" ? request.html : "";
    return this.engine.render(this.prepare(html), page);
  }
}
