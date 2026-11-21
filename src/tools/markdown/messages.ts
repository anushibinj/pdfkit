/** Messages between the Markdown to PDF UI and its Web Worker. */
import type { PageSetup } from "@/lib/html-pdf/types";

export interface ConvertRequest {
  /** Markdown source (CommonMark + GitHub Flavored Markdown) */
  markdown: string;
  /**
   * Stylesheet applied to the rendered Markdown. An `@page { size }` rule in
   * it takes precedence over {@link ConvertRequest.page}.
   */
  css: string;
  page: PageSetup;
}
