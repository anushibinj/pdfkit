/**
 * Types shared by every tool that lays HTML out into a PDF with ironpress
 * (Markdown to PDF, HTML to PDF). Each tool defines its own request type; the
 * page setup and the result coming back from the worker are the same for all.
 */

/** Paper sizes the PDF engine accepts by name. */
export type PageSizeName = "A4" | "Letter" | "Legal";

/** Paper size and a uniform margin applied to every page. */
export interface PageSetup {
  size: PageSizeName;
  /** Margin on all four sides, in millimetres */
  marginMm: number;
}

/** What a conversion worker answers, whatever the tool's request was. */
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
