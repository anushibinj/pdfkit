import type { ImageMime } from "@/lib/image-info";
import type { QuarterTurns } from "@/lib/pdfium/page-box";
import { check, insertNewObject } from "@/lib/pdfium/page-objects";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import {
  StandardPageLayoutCalculator,
  type PageLayoutCalculator,
} from "../core/layout";
import { normalizeLayoutOptions, type PageLayoutOptions } from "../core/options";
import {
  CompositeImageEmbedder,
  InvalidImageError,
  type ImageEmbedder,
} from "./image-embedder";
import type { ImagesToPdfPdfiumApi } from "./pdfium-api";

/** One image payload ready to be written as a single PDF page. */
export interface ImageSource {
  bytes: Uint8Array;
  mime: ImageMime;
  width: number;
  height: number;
  rotation: QuarterTurns;
}

/** Progress callback invoked after each page is added. */
export type BuildProgressCallback = (progress: number, stage: string) => void;

/** Result of building a PDF from images. */
export interface BuiltPdf {
  bytes: Uint8Array;
  pageCount: number;
}

/**
 * Abstraction for the Images-to-PDF engine (Dependency Inversion Principle:
 * the worker handler depends on this interface rather than the concrete builder).
 */
export interface PdfFromImagesEngine {
  /**
   * Build a multi-page PDF containing one page per image in order.
   *
   * @param images Ordered image sources (must be non-empty).
   * @param options Page layout options (sanitised defensively).
   * @param onProgress Optional progress callback (`0..1`).
   * @returns The serialised PDF bytes and page count.
   */
  build(
    images: readonly ImageSource[],
    options: Partial<PageLayoutOptions> | undefined,
    onProgress?: BuildProgressCallback,
  ): BuiltPdf;
}

/**
 * Builds a PDF from PNG and JPEG images using PDFium WebAssembly.
 *
 * SOLID design:
 * - **SRP**: Orchestrates document creation, page iteration, and saving;
 *   delegates geometry to {@link PageLayoutCalculator} and format-specific
 *   loading to {@link ImageEmbedder}.
 * - **DIP**: Accepts all collaborators via constructor injection so every
 *   behavior can be unit-tested with lightweight fakes.
 *
 * Resource safety:
 * - The created {@link PdfiumDocument} is always closed in a `finally` block.
 * - Each page is opened via `doc.withNewPage(...)` so it is always closed
 *   immediately after `FPDFPage_GenerateContent` flushes its content stream,
 *   keeping WASM memory usage flat across large batches of images.
 */
export class ImagesToPdfBuilder implements PdfFromImagesEngine {
  private readonly heap: WasmHeap;

  /**
   * @param api Segregated PDFium WASM bindings.
   * @param embedder Strategy-based image loader and decoder verifier.
   * @param layoutCalculator Pure page-geometry and affine-matrix calculator.
   */
  constructor(
    private readonly api: ImagesToPdfPdfiumApi,
    private readonly embedder: ImageEmbedder = new CompositeImageEmbedder(),
    private readonly layoutCalculator: PageLayoutCalculator = new StandardPageLayoutCalculator(),
  ) {
    this.heap = new WasmHeap(api.pdfium);
  }

  /**
   * Build a PDF containing one page per entry in `images`.
   *
   * @param images Non-empty ordered list of image sources.
   * @param rawOptions Layout options (normalised before use).
   * @param onProgress Optional callback reporting progress in `[0, 1]`.
   * @returns Generated PDF bytes and page count.
   * @throws {Error} When `images` is empty or PDFium cannot generate/save.
   * @throws {InvalidImageError} Naming the failing `imageIndex` when an image
   *   cannot be decoded by PDFium.
   */
  build(
    images: readonly ImageSource[],
    rawOptions: Partial<PageLayoutOptions> | undefined,
    onProgress?: BuildProgressCallback,
  ): BuiltPdf {
    if (images.length === 0) {
      throw new Error("Add at least one image to create a PDF.");
    }

    const options = normalizeLayoutOptions(rawOptions);
    const doc = PdfiumDocument.create(this.api, this.heap);

    try {
      const total = images.length;
      for (let i = 0; i < total; i++) {
        this.addImagePage(doc, i, images[i], options);
        // Reserve the final 10% of progress for serialising the PDF bytes so
        // the progress bar does not sit at 100% while `doc.save()` runs.
        onProgress?.(
          ((i + 1) / total) * 0.9,
          `Added image ${i + 1} of ${total}…`,
        );
      }

      onProgress?.(0.95, "Saving PDF…");
      const bytes = doc.save();
      onProgress?.(1, "Done");
      return { bytes, pageCount: total };
    } finally {
      doc.close();
    }
  }

  /**
   * Create a single page at `index`, embed `image` onto it with its computed
   * affine transform, and flush its content stream.
   *
   * @param doc Open PDFium document being assembled.
   * @param index Zero-based page index (also used to tag errors).
   * @param image Image bytes, format, pixel dimensions, and rotation.
   * @param options Normalised page layout options.
   * @throws {InvalidImageError} Tagged with `index` if embedding fails.
   */
  private addImagePage(
    doc: PdfiumDocument,
    index: number,
    image: ImageSource,
    options: PageLayoutOptions,
  ): void {
    const layout = this.layoutCalculator.compute(
      image.width,
      image.height,
      image.rotation,
      options,
    );

    doc.withNewPage(index, layout.pageWidth, layout.pageHeight, (page) => {
      try {
        insertNewObject(
          { api: this.api, page },
          () => this.api.FPDFPageObj_NewImageObj(doc.handle),
          (object) => {
            this.embedder.embed(
              this.api,
              this.heap,
              page,
              object,
              image.mime,
              image.bytes,
            );
          },
          layout.matrix,
          "an image",
        );
      } catch (err) {
        if (err instanceof InvalidImageError) {
          throw new InvalidImageError(err.message, index);
        }
        throw err;
      }

      // PDFium keeps newly inserted objects in memory only until
      // FPDFPage_GenerateContent serialises them into the page's content stream.
      check(
        this.api.FPDFPage_GenerateContent(page),
        `write page ${index + 1}`,
      );
    });
  }
}
