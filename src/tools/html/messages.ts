/** Messages between the HTML to PDF UI and its Web Worker. */
import type { PageSetup } from "@/lib/html-pdf/types";

export interface HtmlConvertRequest {
  /**
   * The HTML to lay out: a complete document or just a fragment. Its own
   * `<style>` elements and `style` attributes are applied, and an `@page`
   * rule in them (size or margin) takes precedence over
   * {@link HtmlConvertRequest.page}.
   */
  html: string;
  page: PageSetup;
}
