import type { PageSetup, PageSizeName } from "../messages";
import { mmToPoints } from "./page-setup";
import type { PdfEngine } from "./pdf-engine";

/**
 * The slice of ironpress's wasm-bindgen `HtmlConverter` class that we use.
 * Declared here (instead of importing the class) so tests can pass a fake and
 * so this module never loads the 15 MB WebAssembly binary by itself.
 */
export interface IronpressConverter {
  pageSize(name: string): void;
  marginSides(top: number, right: number, bottom: number, left: number): void;
  sanitize(enabled: boolean): void;
  htmlToPdf(html: string): Uint8Array;
  /** Releases the converter's WebAssembly memory. */
  free(): void;
}

/** The part of the initialised ironpress module that we use. */
export interface IronpressApi {
  HtmlConverter: new () => IronpressConverter;
}

/**
 * ironpress's `pageSize()` takes the names "A4", "Letter" and "Legal". The map
 * keeps that spelling decision in one place, even though it is currently 1:1.
 */
const IRONPRESS_PAGE_SIZE: Record<PageSizeName, string> = {
  A4: "A4",
  Letter: "Letter",
  Legal: "Legal",
};

/**
 * {@link PdfEngine} backed by ironpress, a Rust HTML/CSS layout engine
 * compiled to WebAssembly (https://github.com/gastongouron/ironpress, MIT).
 */
export class IronpressEngine implements PdfEngine {
  /**
   * @param api The initialised ironpress module (after its `init()` resolved).
   */
  constructor(private readonly api: IronpressApi) {}

  /**
   * Render HTML to PDF with a fresh converter per call.
   *
   * A new converter each time means no setting can leak from one document to
   * the next. The converter owns memory inside the WebAssembly heap that the
   * JavaScript garbage collector does not see, so `free()` runs in `finally`,
   * on success and on failure alike; otherwise every failed conversion would
   * leak a converter until the worker restarts.
   *
   * Sanitising is switched on explicitly (it is also ironpress's default):
   * Markdown may contain raw HTML, and the engine then drops scripts, iframes,
   * event handlers and `javascript:` URLs.
   *
   * @param html A complete HTML document.
   * @param page Paper size and margins.
   * @returns The PDF bytes produced by ironpress.
   */
  render(html: string, page: PageSetup): Uint8Array {
    const converter = new this.api.HtmlConverter();
    try {
      converter.sanitize(true);
      converter.pageSize(IRONPRESS_PAGE_SIZE[page.size]);
      const margin = mmToPoints(page.marginMm);
      converter.marginSides(margin, margin, margin, margin);
      return converter.htmlToPdf(html);
    } finally {
      converter.free();
    }
  }
}
