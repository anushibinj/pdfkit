import { errorMessage, isOutOfMemory } from "@/lib/errors";
import { PdfiumDocument } from "@/lib/pdfium/document";
import { viewSize } from "@/lib/pdfium/page";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { RgbaImage } from "@/lib/png/png-encoder";
import { imageKey } from "../core/image-key";
import { sanitizeRenderOptions } from "../core/options";
import { pageImageSize } from "../core/render-size";
import {
  defaultStrategies,
  extractImage,
  type ExtractionContext,
  type ExtractionMethod,
  type ImageExtractionStrategy,
} from "./extraction-strategies";
import { PdfiumImageInspector } from "./image-inspector";
import { collectImageObjects } from "./image-objects";
import type { ImagesPdfiumApi } from "./pdfium-api";

/** Turns pixels into files (injected: the worker uses real encoders). */
export interface ImageEncoders {
  /** Lossless PNG. */
  png(image: RgbaImage): Promise<Uint8Array>;
  /** JPEG at a quality from 0 to 1 (opaque images only). */
  jpeg(image: RgbaImage, quality: number): Promise<Uint8Array>;
}

/** MIME types of the files the session produces. */
export type ImageMimeType = "image/png" | "image/jpeg";

/** One page rendered to an image file. */
export interface RenderedPageImage {
  pageIndex: number;
  width: number;
  height: number;
  /** Resolution achieved (lower than requested when `reduced`). */
  dpi: number;
  reduced: boolean;
  mimeType: ImageMimeType;
  bytes: Uint8Array;
}

/** What was found for one image object on a page. */
export type PageImageEntry =
  /** A new image, extracted. */
  | {
      kind: "image";
      key: string;
      width: number;
      height: number;
      mimeType: ImageMimeType;
      method: ExtractionMethod;
      bytes: Uint8Array;
    }
  /** An image already extracted (on this page or listed as known). */
  | { kind: "repeat"; key: string }
  /** A new image that could not be extracted, and why. */
  | {
      kind: "skipped";
      key: string;
      width: number;
      height: number;
      reason: string;
    };

/**
 * Whether an error means the engine itself is broken (out of memory, or a
 * WebAssembly trap after which its memory is in an unknown state), as
 * opposed to one image it could not handle.
 *
 * @param err The thrown value.
 * @returns `true` when the whole request has to fail.
 */
export function isEngineFailure(err: unknown): boolean {
  return (
    isOutOfMemory(err) ||
    (typeof WebAssembly !== "undefined" &&
      err instanceof WebAssembly.RuntimeError)
  );
}

/**
 * The worker's state for one opened PDF: renders pages to image files and
 * extracts the images embedded in them.
 *
 * Nothing is ever written back to the document: images are extracted by
 * changing objects of a loaded page in memory (see `MaskedRenderStrategy`)
 * and the page is then closed unsaved.
 */
export class ImagesSession {
  private readonly heap: WasmHeap;
  private readonly inspector: PdfiumImageInspector;
  private readonly strategies: readonly ImageExtractionStrategy[];
  private doc: PdfiumDocument | null = null;
  private pageCount = 0;

  /**
   * @param api The initialised PDFium module.
   * @param encoders PNG and JPEG encoders.
   * @param createStrategies Builds the extraction chain (injectable for
   *   tests; defaults to {@link defaultStrategies}).
   */
  constructor(
    private readonly api: ImagesPdfiumApi,
    private readonly encoders: ImageEncoders,
    createStrategies: (
      api: ImagesPdfiumApi,
      heap: WasmHeap,
    ) => ImageExtractionStrategy[] = defaultStrategies,
  ) {
    this.heap = new WasmHeap(api.pdfium);
    this.inspector = new PdfiumImageInspector(api, this.heap);
    this.strategies = createStrategies(api, this.heap);
  }

  /**
   * Open a file, replacing any open one.
   *
   * @param bytes The PDF file.
   * @param password The user password, or "" for none.
   * @returns The number of pages.
   * @throws {PdfOpenError} When the file cannot be opened.
   * @throws {Error} When it has no pages.
   */
  open(bytes: Uint8Array, password: string): number {
    this.close();
    const doc = PdfiumDocument.open(this.api, this.heap, bytes, password);
    const count = doc.pageCount();
    if (count < 1) {
      doc.close();
      throw new Error("This PDF has no pages.");
    }
    this.doc = doc;
    this.pageCount = count;
    return count;
  }

  /**
   * Render one page to a PNG or JPEG file.
   *
   * The page is drawn the way a reader shows it: its own rotation applied,
   * annotations included, on white. The pixel size comes from the DPI and
   * the displayed page size (`pageImageSize`), shrunk if it would exceed
   * the browser's limits.
   *
   * @param pageIndex Zero-based page index.
   * @param rawOptions Format, DPI and quality (untrusted: sanitised).
   * @returns The encoded page.
   * @throws When nothing is open or the index is out of range.
   */
  async renderPage(
    pageIndex: number,
    rawOptions: unknown,
  ): Promise<RenderedPageImage> {
    const doc = this.requirePage(pageIndex);
    const options = sanitizeRenderOptions(rawOptions);
    const { box, rotation } = doc.pageInfo(pageIndex);
    const size = pageImageSize(viewSize(box, rotation), options.dpi);
    const { pixels } = doc.render(pageIndex, size.width, size.height, 0);
    const image = { width: size.width, height: size.height, pixels };
    const jpeg = options.format === "jpeg";
    return {
      pageIndex,
      width: size.width,
      height: size.height,
      dpi: size.dpi,
      reduced: size.reduced,
      mimeType: jpeg ? "image/jpeg" : "image/png",
      bytes: jpeg
        ? await this.encoders.jpeg(image, options.quality)
        : await this.encoders.png(image),
    };
  }

  /**
   * Extract the images embedded in one page.
   *
   * For each image object, in content order (forms included):
   * 1. Inspect it (size, filters, colour space, raw bytes) and compute its
   *    identity key from the raw bytes (an image without raw bytes gets a
   *    key of its own).
   * 2. If the key is known (from `knownKeys`, i.e. earlier pages, or from
   *    earlier on this page), report a "repeat" and do no more work.
   * 3. Otherwise run the strategy chain; decoded pixels are encoded as PNG.
   *    If this one image fails (too large, undecodable), it is reported as
   *    "skipped" and the page carries on. Only an engine failure (out of
   *    memory, a trap) fails the whole request.
   * The page stays loaded throughout (`withPageAsync`), because image
   * handles point into it.
   *
   * @param pageIndex Zero-based page index.
   * @param knownKeys Keys of images already extracted from other pages.
   * @returns One entry per image object.
   * @throws When nothing is open, the index is out of range, or the engine
   *   fails.
   */
  async extractImages(
    pageIndex: number,
    knownKeys: readonly string[],
  ): Promise<PageImageEntry[]> {
    const doc = this.requirePage(pageIndex);
    const known = new Set(knownKeys);
    return doc.withPageAsync(pageIndex, async (page) => {
      const entries: PageImageEntry[] = [];
      for (const object of collectImageObjects(this.api, page)) {
        const image = this.inspector.inspect(page, object);
        if (!image) continue;
        // Without raw bytes there is nothing to identify the image by, so
        // it gets a key of its own (never equal to a hashed key, which
        // starts with its size) and is never taken for a repeat.
        const key =
          image.raw.length > 0
            ? await imageKey(image.raw, image)
            : `unhashed:${pageIndex}:${entries.length}`;
        if (known.has(key)) {
          entries.push({ kind: "repeat", key });
          continue;
        }
        known.add(key);
        entries.push(
          await this.extractOne({ doc: doc.handle, page, image }, key),
        );
      }
      return entries;
    });
  }

  /** Close the open document and free its memory. Safe to call twice. */
  close(): void {
    this.doc?.close();
    this.doc = null;
    this.pageCount = 0;
  }

  /**
   * Extract one new image and encode it.
   *
   * @param context The image and where it lives.
   * @param key Its identity key.
   * @returns The image entry, or a "skipped" entry with the reason.
   * @throws Engine failures (see {@link isEngineFailure}).
   */
  private async extractOne(
    context: ExtractionContext,
    key: string,
  ): Promise<PageImageEntry> {
    const { width, height } = context.image;
    try {
      const extracted = extractImage(this.strategies, context);
      if (extracted.method === "original-jpeg") {
        return {
          kind: "image",
          key,
          width,
          height,
          mimeType: extracted.mimeType,
          method: extracted.method,
          bytes: extracted.bytes,
        };
      }
      return {
        kind: "image",
        key,
        width: extracted.pixels.width,
        height: extracted.pixels.height,
        mimeType: "image/png",
        method: extracted.method,
        bytes: await this.encoders.png(extracted.pixels),
      };
    } catch (err) {
      if (isEngineFailure(err)) throw err;
      return { kind: "skipped", key, width, height, reason: errorMessage(err) };
    }
  }

  /**
   * Check that a document is open and has the page.
   *
   * @param pageIndex Zero-based page index (untrusted).
   * @returns The open document.
   * @throws {Error} When nothing is open or the index is invalid.
   */
  private requirePage(pageIndex: number): PdfiumDocument {
    if (!this.doc) throw new Error("No PDF is open.");
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= this.pageCount
    ) {
      throw new Error(`Page ${pageIndex + 1} does not exist.`);
    }
    return this.doc;
  }
}
