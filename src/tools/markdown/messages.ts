/** Messages between the Markdown to PDF UI and its Web Worker. */

/** Paper sizes the PDF engine accepts by name. */
export type PageSizeName = "A4" | "Letter" | "Legal";

/** Paper size and a uniform margin applied to every page. */
export interface PageSetup {
  size: PageSizeName;
  /** Margin on all four sides, in millimetres */
  marginMm: number;
}

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

export type ConvertResult =
  | {
      status: "converted";
      /** PDF bytes (transferred, not copied) */
      data: ArrayBuffer;
    }
  | {
      status: "error";
      /**
       * "crashed": the WebAssembly engine trapped and the worker must be
       * replaced before the next conversion.
       */
      reason: "out-of-memory" | "crashed" | "failed";
      message: string;
    };
