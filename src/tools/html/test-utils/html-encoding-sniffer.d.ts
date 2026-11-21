/**
 * Types for `html-encoding-sniffer` (no bundled typings), used only by tests
 * as the reference implementation of the WHATWG encoding sniffing algorithm.
 */
declare module "html-encoding-sniffer" {
  interface SniffOptions {
    /** Returned when no encoding is found (defaults to "windows-1252"). */
    defaultEncoding?: string;
    maxPrescanBytes?: number;
    transportLayerEncodingLabel?: string;
    xml?: boolean;
  }
  /** @returns An Encoding Standard name, e.g. "UTF-8" or "windows-1252". */
  export default function sniffHTMLEncoding(
    bytes: Uint8Array,
    options?: SniffOptions,
  ): string;
}
