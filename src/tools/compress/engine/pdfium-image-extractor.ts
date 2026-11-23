/**
 * PDFium image extraction, drawn-DPI calculation, replacement generation,
 * and side-by-side page preview rendering.
 *
 * Follows Single Responsibility Principle (SRP) and Interface Segregation Principle (ISP):
 * reuses PDFium's object-walking, bitmap-reading, and transparency-probing primitives
 * to decode complex PDF images (DCTDecode, JPXDecode, ICCBased, CMYK, Indexed) into
 * RGBA pixels, and renders matched page pairs for visual before/after inspection.
 */

import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import { viewSize } from "@/lib/pdfium/page-box";
import { FPDF_ERR } from "@/lib/pdfium/core-api";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { RgbaImage } from "@/lib/png/png-encoder";
import {
  hasClipPath,
  readBitmap,
  RenderedTransparencyProbe,
  NativeImageRenderer,
} from "@/tools/pdf-to-images/engine/extraction-strategies";
import { PdfiumImageInspector } from "@/tools/pdf-to-images/engine/image-inspector";
import { collectImageObjects } from "@/tools/pdf-to-images/engine/image-objects";
import type { ImagesPdfiumApi } from "@/tools/pdf-to-images/engine/pdfium-api";
import type {
  ImageReplacementEntry,
  ResolvedPassConfig,
} from "../core/model";
import {
  computeTargetImageDimensions,
  fnv1aHash64,
} from "../core/options";

/** Minimal PDFium surface needed by Compress PDF (reuses {@link ImagesPdfiumApi}). */
export type CompressPdfiumApi = ImagesPdfiumApi;

/** Maximum pixel count allowed when decoding an image via PDFium (40 MP). */
const MAX_EXTRACT_PIXELS = 40_000_000;

/** Source image extracted from a PDF via PDFium for potential JPEG re-encoding. */
export interface ExtractedSourceImage {
  /** 64-bit FNV-1a hash of the raw PDF stream bytes. */
  rawHash: bigint;
  /** Stored image width in pixels. */
  width: number;
  /** Stored image height in pixels. */
  height: number;
  /** Maximum drawn width on any page in PDF points. */
  drawnWidthPt: number;
  /** Maximum drawn height on any page in PDF points. */
  drawnHeightPt: number;
  /** Byte length of the existing stream in the PDF. */
  rawLength: number;
  /** True when the stream already uses `/DCTDecode`. */
  isJpeg: boolean;
  /** True when the image carries alpha/mask transparency and must stay lossless. */
  hasTransparency: boolean;
  /** Decoded RGBA pixels at original pixel size. */
  pixels: RgbaImage;
}

/** Function encoding RGBA pixels (with optional resizing) to JPEG bytes. */
export type JpegEncodeFn = (
  image: RgbaImage,
  targetWidth: number,
  targetHeight: number,
  quality: number,
  grayscale: boolean,
) => Promise<Uint8Array>;

/** Side-by-side rendered page preview returned to the worker/UI. */
export interface PreviewPairResult {
  pageIndex: number;
  pageCount: number;
  width: number;
  height: number;
  originalPixels: Uint8Array;
  compressedPixels: Uint8Array;
}

/** Verification outcome from opening a PDF in PDFium. */
export type PdfiumVerifyResult =
  | { valid: true; pageCount: number }
  | { valid: false; reason: "password-required" | "corrupt"; message: string };

/**
 * Extracts opaque embedded images with their drawn dimensions from PDFium and
 * builds size-guarded JPEG replacements + side-by-side preview renders.
 */
export class PdfiumImageExtractor {
  private readonly heap: WasmHeap;
  private readonly inspector: PdfiumImageInspector;
  private readonly transparencyProbe: RenderedTransparencyProbe;

  /**
   * @param api Initialized PDFium WebAssembly API.
   */
  constructor(private readonly api: CompressPdfiumApi) {
    this.heap = new WasmHeap(api.pdfium);
    this.inspector = new PdfiumImageInspector(api, this.heap);
    const renderer = new NativeImageRenderer(api, this.heap);
    this.transparencyProbe = new RenderedTransparencyProbe(renderer, api);
  }

  /**
   * Checks that `bytes` opens cleanly in PDFium and has at least one page.
   *
   * @param bytes PDF bytes to inspect.
   * @param password Optional open password.
   * @returns {@link PdfiumVerifyResult}.
   */
  verifyAndCountPages(bytes: Uint8Array, password = ""): PdfiumVerifyResult {
    if (bytes.length === 0) {
      return { valid: false, reason: "corrupt", message: "PDF file is empty." };
    }

    const ptr = this.heap.copyIn(bytes);
    try {
      const doc = this.api.FPDF_LoadMemDocument(ptr, bytes.length, password);
      if (!doc) {
        const err = this.api.FPDF_GetLastError();
        if (err === FPDF_ERR.PASSWORD) {
          return {
            valid: false,
            reason: "password-required",
            message: "Password required to open this PDF.",
          };
        }
        return {
          valid: false,
          reason: "corrupt",
          message: "Could not open this PDF document.",
        };
      }

      try {
        const pageCount = this.api.FPDF_GetPageCount(doc);
        if (pageCount <= 0) {
          return {
            valid: false,
            reason: "corrupt",
            message: "This PDF has no pages.",
          };
        }
        return { valid: true, pageCount };
      } finally {
        this.api.FPDF_CloseDocument(doc);
      }
    } finally {
      this.heap.free(ptr);
    }
  }

  /**
   * Walks every page of `bytes` and decodes unique opaque embedded images
   * suitable for lossy JPEG optimization.
   *
   * Deduplicates by `rawHash` while accumulating the largest `(drawnWidthPt, drawnHeightPt)`
   * across all placements so an image drawn small on page 1 and large on page 3 is never
   * over-downsampled for page 3.
   *
   * @param bytes Unencrypted PDF bytes.
   * @param password Optional open password.
   * @returns Deduplicated list of {@link ExtractedSourceImage} entries.
   */
  extractCompressibleImages(
    bytes: Uint8Array,
    password = "",
  ): ExtractedSourceImage[] {
    const doc = PdfiumDocument.open(this.api, this.heap, bytes, password);
    const byKey = new Map<string, ExtractedSourceImage>();

    try {
      const pageCount = doc.pageCount();
      for (let p = 0; p < pageCount; p++) {
        doc.withPage(p, (page) => {
          const objects = collectImageObjects(this.api, page);
          for (const object of objects) {
            const info = this.inspector.inspect(page, object);
            if (!info || info.raw.length === 0) continue;
            if (info.width * info.height > MAX_EXTRACT_PIXELS) continue;

            const { drawnWidthPt, drawnHeightPt } = this.readDrawnSizePt(object);
            const rawHash = fnv1aHash64(info.raw);
            const dedupKey = `${rawHash.toString(16)}:${info.width}x${info.height}`;

            const existing = byKey.get(dedupKey);
            if (existing) {
              existing.drawnWidthPt = Math.max(
                existing.drawnWidthPt,
                drawnWidthPt,
              );
              existing.drawnHeightPt = Math.max(
                existing.drawnHeightPt,
                drawnHeightPt,
              );
              continue;
            }

            // Clipped or transparent images (soft masks, stencils) stay lossless in Rust
            // so transparency and sharp logo edges never degrade.
            const isClipped = hasClipPath(this.api, object);
            const hasAlpha =
              !isClipped &&
              this.transparencyProbe.hasTransparency({
                doc: doc.handle,
                page,
                image: info,
              });
            if (hasAlpha) {
              continue;
            }

            const bitmap = this.api.FPDFImageObj_GetBitmap(object);
            if (!bitmap) continue;
            let pixels: RgbaImage;
            try {
              pixels = readBitmap(this.api, bitmap);
            } finally {
              this.api.FPDFBitmap_Destroy(bitmap);
            }

            const isJpeg = info.filters.includes("DCTDecode");
            byKey.set(dedupKey, {
              rawHash,
              width: info.width,
              height: info.height,
              drawnWidthPt,
              drawnHeightPt,
              rawLength: info.raw.length,
              isJpeg,
              hasTransparency: false,
              pixels,
            });
          }
        });
      }
    } finally {
      doc.close();
    }

    return [...byKey.values()];
  }

  /**
   * Builds pre-encoded JPEG stream replacements for a given {@link ResolvedPassConfig}.
   *
   * Enforces Issue #20's safeguards:
   * - Returns `[]` immediately in `lossless` mode.
   * - Skips JPEG images already at/below target DPI when not converting to grayscale
   *   and already compact (`< 0.35 bytes/pixel`).
   * - Discards any re-encode that is not strictly smaller than the original stream bytes.
   *
   * @param images Source images extracted by {@link extractCompressibleImages}.
   * @param config Concrete pass configuration.
   * @param encodeJpeg Injected JPEG encoder.
   * @returns List of strictly-smaller {@link ImageReplacementEntry} records.
   */
  async buildReplacements(
    images: readonly ExtractedSourceImage[],
    config: ResolvedPassConfig,
    encodeJpeg: JpegEncodeFn,
  ): Promise<ImageReplacementEntry[]> {
    if (config.lossless || images.length === 0) {
      return [];
    }

    const replacements: ImageReplacementEntry[] = [];
    for (const img of images) {
      const target = computeTargetImageDimensions(
        img.width,
        img.height,
        img.drawnWidthPt,
        img.drawnHeightPt,
        config.targetDpi,
      );

      // Skip already-compact JPEGs that are already below target DPI unless grayscale is requested
      const bytesPerPixel = img.rawLength / Math.max(1, img.width * img.height);
      if (
        !target.downsampled &&
        !config.grayscale &&
        img.isJpeg &&
        bytesPerPixel < 0.35 &&
        config.quality >= 0.7
      ) {
        continue;
      }

      const jpegBytes = await encodeJpeg(
        img.pixels,
        target.width,
        target.height,
        config.quality,
        config.grayscale,
      );

      // Keep the original whenever the re-encode is bigger or equal
      if (jpegBytes.length === 0 || jpegBytes.length >= img.rawLength) {
        continue;
      }

      replacements.push({
        rawHash: img.rawHash,
        originalWidth: img.width,
        originalHeight: img.height,
        newWidth: target.width,
        newHeight: target.height,
        grayscale: config.grayscale,
        jpegBytes,
      });
    }

    return replacements;
  }

  /**
   * Renders the same page of both `originalPdf` and `compressedPdf` at `targetWidth`
   * for the side-by-side comparison preview.
   *
   * @param originalPdf Original PDF bytes.
   * @param compressedPdf Compressed PDF bytes.
   * @param pageIndex Zero-based page index.
   * @param targetWidth Target canvas width in pixels.
   * @param password Optional open password for the original PDF.
   * @returns Matching RGBA buffers and pixel dimensions.
   */
  renderPreviewPair(
    originalPdf: Uint8Array,
    compressedPdf: Uint8Array,
    pageIndex: number,
    targetWidth: number,
    password = "",
  ): PreviewPairResult {
    const origDoc = PdfiumDocument.open(
      this.api,
      this.heap,
      originalPdf,
      password,
    );
    try {
      const pageCount = origDoc.pageCount();
      const clampedIndex = Math.max(0, Math.min(pageCount - 1, pageIndex));
      const { box, rotation } = origDoc.pageInfo(clampedIndex);
      const view = viewSize(box, rotation);
      const width = Math.max(120, Math.min(1400, Math.round(targetWidth)));
      const height = Math.max(
        120,
        Math.round((width * view.height) / Math.max(1, view.width)),
      );

      const originalRender = origDoc.render(clampedIndex, width, height, 0);

      const compDoc = PdfiumDocument.open(
        this.api,
        this.heap,
        compressedPdf,
        "",
      );
      try {
        const compCount = compDoc.pageCount();
        const compIdx = Math.min(clampedIndex, compCount - 1);
        const compressedRender = compDoc.render(compIdx, width, height, 0);

        return {
          pageIndex: clampedIndex,
          pageCount,
          width,
          height,
          originalPixels: originalRender.pixels,
          compressedPixels: compressedRender.pixels,
        };
      } finally {
        compDoc.close();
      }
    } finally {
      origDoc.close();
    }
  }

  /**
   * Reads the `FS_MATRIX` of an image object to obtain its drawn extent in PDF points.
   */
  private readDrawnSizePt(object: number): {
    drawnWidthPt: number;
    drawnHeightPt: number;
  } {
    return this.heap.using(this.heap.alloc(24), (ptr) => {
      if (!this.api.FPDFPageObj_GetMatrix(object, ptr)) {
        return { drawnWidthPt: 0, drawnHeightPt: 0 };
      }
      const view = new DataView(
        this.api.pdfium.HEAPU8.buffer,
        this.api.pdfium.HEAPU8.byteOffset + ptr,
        24,
      );
      const a = view.getFloat32(0, true);
      const b = view.getFloat32(4, true);
      const c = view.getFloat32(8, true);
      const d = view.getFloat32(12, true);
      return {
        drawnWidthPt: Math.hypot(a, b),
        drawnHeightPt: Math.hypot(c, d),
      };
    });
  }
}
