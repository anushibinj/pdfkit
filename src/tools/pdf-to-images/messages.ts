/** Messages between the PDF to Images UI and its Web Worker. */
import type { PageRenderOptions } from "./core/options";
import type { ExtractionMethod } from "./engine/extraction-strategies";
import type { ImageMimeType } from "./engine/images-session";

export type ImagesRequest =
  /** Open a file (replacing any open one). `data` is transferred. */
  | { op: "open"; data: ArrayBuffer; password?: string }
  /** Render one page of the open file to an image file. */
  | { op: "render-page"; pageIndex: number; options: PageRenderOptions }
  /**
   * Extract the images of one page. Images whose key is in `knownKeys`
   * (found on earlier pages) are reported as repeats, not extracted again.
   */
  | { op: "extract-images"; pageIndex: number; knownKeys: string[] }
  /** Close the file and free its memory. */
  | { op: "close" };

/**
 * - "out-of-memory": the browser could not give the engine more memory.
 * - "crashed": the WebAssembly engine trapped; the worker must be replaced
 *   (and the file opened again) before it is used again.
 * - "failed": an ordinary error; the worker is still usable.
 */
export type FailureReason = "out-of-memory" | "crashed" | "failed";

export interface ErrorResult {
  status: "error";
  reason: FailureReason;
  message: string;
}

export type OpenResult =
  | { status: "opened"; pageCount: number }
  /** The file is encrypted and no password was given. */
  | { status: "password-required" }
  /** A password was given and it is not the right one. */
  | { status: "wrong-password" }
  | ErrorResult;

export type RenderPageResult =
  | {
      status: "page";
      pageIndex: number;
      width: number;
      height: number;
      /** Resolution achieved, lower than requested when `reduced`. */
      dpi: number;
      reduced: boolean;
      mimeType: ImageMimeType;
      /** The image file (transferred). */
      data: ArrayBuffer;
    }
  | ErrorResult;

/** One image object of a page, as sent over the wire. */
export type WireImageEntry =
  | {
      kind: "image";
      key: string;
      width: number;
      height: number;
      mimeType: ImageMimeType;
      method: ExtractionMethod;
      /** The image file (transferred). */
      data: ArrayBuffer;
    }
  | { kind: "repeat"; key: string }
  | {
      kind: "skipped";
      key: string;
      width: number;
      height: number;
      reason: string;
    };

export type ExtractImagesResult =
  | { status: "images"; pageIndex: number; entries: WireImageEntry[] }
  | ErrorResult;

export type CloseResult = { status: "closed" };

/** The result type for each request `op`. */
export interface ResultFor {
  open: OpenResult;
  "render-page": RenderPageResult;
  "extract-images": ExtractImagesResult;
  close: CloseResult;
}

export type ImagesResult = ResultFor[keyof ResultFor];
