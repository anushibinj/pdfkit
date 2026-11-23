// @vitest-environment node
/**
 * End-to-end integration tests for Images to PDF using the real PDFium
 * WebAssembly binary. Builds real PDFs from actual PNG and JPEG images, then
 * opens the resulting document in PDFium to verify page structure, dimensions,
 * and content integrity.
 */
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { beforeAll, describe, expect, it } from "vitest";
import { boxSize } from "@/lib/pdfium/page-box";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import { loadNodePdfiumModule } from "@/lib/pdfium/test-utils/node-pdfium";
import { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { GREEN_JPEG, makePng } from "@/lib/test-utils/images";
import { asImagesToPdfPdfiumApi } from "../worker/load-pdfium";
import { InvalidImageError } from "./image-embedder";
import {
  ImagesToPdfBuilder,
  type ImageSource,
} from "./pdf-builder";
import type { ImagesToPdfPdfiumApi } from "./pdfium-api";

describe("ImagesToPdfBuilder (real PDFium WebAssembly)", () => {
  let rawPdfium: WrappedPdfiumModule;
  let api: ImagesToPdfPdfiumApi;
  let heap: WasmHeap;
  let builder: ImagesToPdfBuilder;

  // Real PNG image: 16x8 pixels (RGBA, solid blue)
  let testPng: Uint8Array;
  // Real JPEG image: 8x8 pixels (baseline JPEG, solid green)
  const testJpeg = GREEN_JPEG;

  beforeAll(async () => {
    rawPdfium = await loadNodePdfiumModule();
    api = asImagesToPdfPdfiumApi(rawPdfium);
    heap = new WasmHeap(api.pdfium);
    builder = new ImagesToPdfBuilder(api);

    testPng = makePng(16, 8, () => [0, 0, 255, 255]);
  });

  /**
   * Helper to open built PDF bytes in PDFium and run assertions.
   *
   * @param bytes Serialised PDF bytes.
   * @param fn Callback that inspects the opened PDFiumDocument.
   */
  function withOpenedPdf<T>(
    bytes: Uint8Array,
    fn: (doc: PdfiumDocument) => T,
  ): T {
    const doc = PdfiumDocument.open(api, heap, bytes, "");
    try {
      return fn(doc);
    } finally {
      doc.close();
    }
  }

  it("builds a single-page PDF from a PNG in fit mode", () => {
    const image: ImageSource = {
      bytes: testPng,
      mime: "image/png",
      width: 16,
      height: 8,
      rotation: 0,
    };

    const built = builder.build([image], { pageSize: "fit", marginMm: 0 });
    expect(built.pageCount).toBe(1);
    expect(built.bytes.length).toBeGreaterThan(0);

    withOpenedPdf(built.bytes, (doc) => {
      expect(doc.pageCount()).toBe(1);
      const info = doc.pageInfo(0);
      const size = boxSize(info.box);
      // At 0 margin in "fit" mode, page points equal pixel dimensions (16 x 8)
      expect(size.width).toBeCloseTo(16, 1);
      expect(size.height).toBeCloseTo(8, 1);
    });
  });

  it("builds a multi-page PDF combining PNG and JPEG with rotations", () => {
    const images: ImageSource[] = [
      {
        bytes: testPng,
        mime: "image/png",
        width: 16,
        height: 8,
        rotation: 1, // 90 deg clockwise -> effective 8 x 16
      },
      {
        bytes: testJpeg,
        mime: "image/jpeg",
        width: 8,
        height: 8,
        rotation: 0,
      },
    ];

    const stages: string[] = [];
    const built = builder.build(
      images,
      { pageSize: "fit", marginMm: 0 },
      (_p, stage) => stages.push(stage),
    );

    expect(built.pageCount).toBe(2);
    expect(stages.length).toBeGreaterThanOrEqual(2);

    withOpenedPdf(built.bytes, (doc) => {
      expect(doc.pageCount()).toBe(2);

      // First page: rotated 90 deg, so width=8, height=16
      const first = boxSize(doc.pageInfo(0).box);
      expect(first.width).toBeCloseTo(8, 1);
      expect(first.height).toBeCloseTo(16, 1);

      // Second page: square JPEG 8x8
      const second = boxSize(doc.pageInfo(1).box);
      expect(second.width).toBeCloseTo(8, 1);
      expect(second.height).toBeCloseTo(8, 1);
    });
  });

  it("builds standard A4 portrait pages with margins and contain scaling", () => {
    const image: ImageSource = {
      bytes: testPng,
      mime: "image/png",
      width: 16,
      height: 8,
      rotation: 0,
    };

    const built = builder.build([image], {
      pageSize: "A4",
      orientation: "portrait",
      marginMm: 10,
      scaleMode: "contain",
    });

    withOpenedPdf(built.bytes, (doc) => {
      expect(doc.pageCount()).toBe(1);
      const size = boxSize(doc.pageInfo(0).box);
      // A4 portrait is 595.28 x 841.89 points
      expect(size.width).toBeCloseTo(595.28, 1);
      expect(size.height).toBeCloseTo(841.89, 1);
    });
  });

  it("builds Letter landscape pages when requested", () => {
    const image: ImageSource = {
      bytes: testJpeg,
      mime: "image/jpeg",
      width: 8,
      height: 8,
      rotation: 0,
    };

    const built = builder.build([image], {
      pageSize: "Letter",
      orientation: "landscape",
      marginMm: 5,
    });

    withOpenedPdf(built.bytes, (doc) => {
      const size = boxSize(doc.pageInfo(0).box);
      // Letter landscape: 792 x 612 points
      expect(size.width).toBeCloseTo(792, 1);
      expect(size.height).toBeCloseTo(612, 1);
    });
  });

  it("throws InvalidImageError tagged with image index on corrupted image payload", () => {
    const corruptImage: ImageSource = {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]), // corrupt PNG
      mime: "image/png",
      width: 16,
      height: 8,
      rotation: 0,
    };

    expect(() => builder.build([corruptImage], undefined)).toThrow(
      InvalidImageError,
    );

    try {
      builder.build([corruptImage], undefined);
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidImageError);
      expect((err as InvalidImageError).imageIndex).toBe(0);
    }
  });

  it("throws an error when image array is empty", () => {
    expect(() => builder.build([], undefined)).toThrow(
      "Add at least one image to create a PDF.",
    );
  });
});
