/**
 * PDFium page inspector, high-DPI rasterizer, and PNG/JPEG-to-PDF adapter.
 *
 * Follows Single Responsibility Principle (SRP) and Dependency Inversion Principle (DIP):
 * isolates PDFium memory management, existing-text detection, TrimBox-aware placement
 * sizing, and image-to-PDF conversion from Tesseract and qpdf orchestration.
 */

import { readImageInfo } from "@/lib/image-info";
import { FPDF_ERR } from "@/lib/pdfium/core-api";
import { viewSize, type Size } from "@/lib/pdfium/page-box";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import { fitRenderSize } from "@/lib/pdfium/render-size";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { ImagesToPdfBuilder } from "@/tools/images-to-pdf/engine/pdf-builder";
import { DEFAULT_LAYOUT_OPTIONS } from "@/tools/images-to-pdf/core/options";
import { readTrimBox } from "@/tools/watermark/engine/placement-size";
import type { OcrDpi } from "../core/model";
import { countNonWhitespaceChars } from "../core/report";
import type { OcrPdfiumApi } from "./pdfium-api";

/** Metadata collected per page during initial PDF inspection. */
export interface InspectedOcrPage {
  /** Zero-based page index. */
  pageIndex: number;
  /** Displayed size in PDF points (`TrimBox ?? boundingBox`, rotated). */
  placementSize: Size;
  /** Existing selectable text already present in the PDF page. */
  existingText: string;
  /** True when the page already contains non-whitespace characters. */
  hasExistingText: boolean;
}

/** Rendered RGBA page bitmap and effective DPI for Tesseract OCR. */
export interface RenderedOcrPage {
  pixels: Uint8Array;
  width: number;
  height: number;
  effectiveDpiX: number;
  effectiveDpiY: number;
  placementSize: Size;
}

/** Contract implemented by {@link PdfiumPageProcessor} for unit testing. */
export interface OcrPageProcessor {
  ensurePdfBytes(inputBytes: Uint8Array): {
    pdfBytes: Uint8Array;
    wasImageInput: boolean;
  };
  inspectPages(pdfBytes: Uint8Array, password: string): InspectedOcrPage[];
  renderPageForOcr(
    pdfBytes: Uint8Array,
    password: string,
    pageIndex: number,
    targetDpi: OcrDpi,
  ): RenderedOcrPage;
}

/**
 * PDFium-backed page processor for OCR.
 */
export class PdfiumPageProcessor implements OcrPageProcessor {
  private readonly heap: WasmHeap;
  private readonly imagePdfBuilder: ImagesToPdfBuilder;

  /**
   * @param api Segregated PDFium WASM API.
   */
  constructor(private readonly api: OcrPdfiumApi) {
    this.heap = new WasmHeap(api.pdfium);
    this.imagePdfBuilder = new ImagesToPdfBuilder(api);
  }

  /**
   * If `inputBytes` is a PNG or JPEG image (checked by magic bytes), converts it
   * into a 1-page PDF sized cleanly to the image at 72 DPI; otherwise returns the
   * bytes unchanged as a PDF.
   *
   * @param inputBytes Uploaded PDF, PNG, or JPEG bytes.
   * @returns Normalized PDF bytes + flag indicating image conversion.
   */
  ensurePdfBytes(inputBytes: Uint8Array): {
    pdfBytes: Uint8Array;
    wasImageInput: boolean;
  } {
    const imgInfo = readImageInfo(inputBytes);
    if (!imgInfo) {
      return { pdfBytes: inputBytes, wasImageInput: false };
    }

    const built = this.imagePdfBuilder.build(
      [
        {
          bytes: inputBytes,
          mime: imgInfo.mime,
          width: imgInfo.width,
          height: imgInfo.height,
          rotation: 0,
        },
      ],
      {
        ...DEFAULT_LAYOUT_OPTIONS,
        pageSize: "fit",
        marginMm: 0,
      },
    );
    return { pdfBytes: built.bytes, wasImageInput: true };
  }

  /**
   * Opens a PDF in PDFium, inspects every page's existing selectable text and
   * `qpdf --overlay` placement size, and closes the document cleanly.
   *
   * @param pdfBytes PDF bytes.
   * @param password Open password, or `""`.
   * @returns Per-page inspection metadata.
   * @throws When the PDF cannot be opened or contains 0 pages.
   */
  inspectPages(pdfBytes: Uint8Array, password: string): InspectedOcrPage[] {
    const doc = PdfiumDocument.open(this.api, this.heap, pdfBytes, password);
    try {
      const count = doc.pageCount();
      if (count <= 0) {
        throw new Error("This PDF contains no pages.");
      }

      const pages: InspectedOcrPage[] = [];
      for (let i = 0; i < count; i++) {
        const info = doc.pageInfo(i);
        const trim = doc.withPage(i, (page) => readTrimBox(this.api, this.heap, page));
        const placementSize = viewSize(trim ?? info.box, info.rotation);

        const existingText = doc.withPage(i, (page) => this.extractText(page));
        const hasExistingText = countNonWhitespaceChars(existingText) > 0;

        pages.push({
          pageIndex: i,
          placementSize,
          existingText,
          hasExistingText,
        });
      }
      return pages;
    } finally {
      doc.close();
    }
  }

  /**
   * Renders a single page at `targetDpi` (clamped by PDFium's 4096px / 16 MP safe
   * bitmap limit) and computes the resulting effective DPI for Tesseract.
   *
   * @param pdfBytes PDF bytes.
   * @param password Open password, or `""`.
   * @param pageIndex Zero-based page index.
   * @param targetDpi Desired rasterization DPI (`150 | 200 | 300`).
   * @returns Rendered RGBA pixels + effective horizontal/vertical DPI.
   */
  renderPageForOcr(
    pdfBytes: Uint8Array,
    password: string,
    pageIndex: number,
    targetDpi: OcrDpi,
  ): RenderedOcrPage {
    const doc = PdfiumDocument.open(this.api, this.heap, pdfBytes, password);
    try {
      const info = doc.pageInfo(pageIndex);
      const trim = doc.withPage(pageIndex, (page) =>
        readTrimBox(this.api, this.heap, page),
      );
      const placementSize = viewSize(trim ?? info.box, info.rotation);
      const renderedView = viewSize(info.box, info.rotation);

      const requestedWidth = Math.max(
        1,
        Math.round((renderedView.width * targetDpi) / 72),
      );
      const targetSize = fitRenderSize(renderedView, requestedWidth);

      const rendered = doc.render(
        pageIndex,
        targetSize.width,
        targetSize.height,
        0,
      );

      // Compute effective DPI from actual bitmap pixel dimensions so even huge
      // poster pages clamped by `fitRenderSize` map OCR coordinates accurately.
      const effectiveDpiX = Math.max(
        72,
        Math.round((rendered.width * 72) / Math.max(1, renderedView.width)),
      );
      const effectiveDpiY = Math.max(
        72,
        Math.round((rendered.height * 72) / Math.max(1, renderedView.height)),
      );

      return {
        pixels: rendered.pixels,
        width: rendered.width,
        height: rendered.height,
        effectiveDpiX,
        effectiveDpiY,
        placementSize,
      };
    } finally {
      doc.close();
    }
  }

  /**
   * Extracts UTF-8 reading-order text from an open `FPDF_PAGE`.
   */
  private extractText(page: number): string {
    const textPage = this.api.FPDFText_LoadPage(page);
    if (!textPage) return "";
    try {
      const count = this.api.FPDFText_CountChars(textPage);
      if (count <= 0) return "";
      let out = "";
      for (let i = 0; i < count; i++) {
        const code = this.api.FPDFText_GetUnicode(textPage, i);
        if (
          code > 0 &&
          code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff)
        ) {
          out += String.fromCodePoint(code);
        }
      }
      return out.trim();
    } finally {
      this.api.FPDFText_ClosePage(textPage);
    }
  }
}

/**
 * Classifies whether `FPDF_GetLastError()` indicates a password failure.
 *
 * @param code Error code from PDFium.
 * @returns `true` if password-related.
 */
export function isPasswordPdfiumCode(code: number): boolean {
  return code === FPDF_ERR.PASSWORD;
}
