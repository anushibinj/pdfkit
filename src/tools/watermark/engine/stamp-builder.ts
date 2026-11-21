import { compose, type Matrix } from "@/lib/affine";
import type { Size } from "@/lib/pdfium/page-box";
import { check, insertNewObject } from "@/lib/pdfium/page-objects";
import { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { layoutWatermark } from "../core/layout";
import type { WatermarkSpec } from "../core/model";
import { painterFor, type PainterRegistry } from "./painters/painter";
import type { WatermarkPdfiumApi } from "./watermark-pdfium-api";

/**
 * Marked-content tag put around every watermark copy. PDF/UA and tagged
 * PDF readers (screen readers, reflow, accessible text extraction) skip
 * artifacts, which is what a watermark is. It has no properties: PDFium can
 * only write property values as strings, while the standard /Type and
 * /Subtype of an artifact must be names, so leaving them out is the
 * correct choice rather than writing them wrong.
 */
export const ARTIFACT_TAG = "Artifact";

/**
 * Builds the "stamp" PDF: one page per distinct page size, each holding the
 * watermark copies laid out for that size.
 *
 * Why a separate PDF instead of drawing on the user's pages with PDFium:
 * `FPDFPage_GenerateContent` rewrites a page's whole content stream from
 * PDFium's own model, and that model does not round-trip everything (a
 * shading drawn with `sh` came back as a reference to object 0 and
 * vanished, checked against the WebAssembly build). The stamp PDF only
 * contains what we draw, so regenerating its content is safe; qpdf then
 * lays its pages onto the user's pages without touching their content.
 */
export class StampBuilder {
  /**
   * @param api The PDFium module.
   * @param heap Memory helper for it.
   * @param painters One painter per content kind.
   */
  constructor(
    private readonly api: WatermarkPdfiumApi,
    private readonly heap: WasmHeap,
    private readonly painters: PainterRegistry,
  ) {}

  /**
   * Draw the stamp pages.
   *
   * Steps:
   * 1. Draw the content once on page 0 of a scratch document, sized to the
   *    content's natural box, and write it into that page's content.
   * 2. Copy that page into the stamp document as a form XObject. Every copy
   *    of the watermark is a small form object referencing this one
   *    XObject, so text glyphs and picture bytes are stored once, however
   *    many copies a tiled page has.
   * 3. For each stamp page: lay out the copies for its size, give each copy
   *    the matrix layout x (natural box -> copy size), tag it as an
   *    artifact and add it; then write the page's content.
   * 4. Save the stamp document. Both documents are closed whatever happens.
   *
   * @param spec The validated watermark.
   * @param sizes The displayed size of each stamp page.
   * @returns The stamp PDF's bytes.
   * @throws When PDFium fails at any step.
   */
  build(spec: WatermarkSpec, sizes: readonly Size[]): Uint8Array {
    const { api, heap } = this;
    const scratch = PdfiumDocument.create(api, heap);
    try {
      const stamp = PdfiumDocument.create(api, heap);
      try {
        const content = painterFor(this.painters, spec.content).prepare(
          spec.content,
          spec.opacity,
          { api, heap, doc: scratch.handle },
        );
        const { natural } = content;
        scratch.withNewPage(0, natural.width, natural.height, (page) => {
          content.draw(page);
          check(api.FPDFPage_GenerateContent(page), "draw the watermark");
        });
        const xobject = api.FPDF_NewXObjectFromPage(
          stamp.handle,
          scratch.handle,
          0,
        );
        if (!xobject) throw new Error("PDFium could not reuse the watermark");
        try {
          sizes.forEach((size, index) =>
            stamp.withNewPage(index, size.width, size.height, (page) => {
              const copy = content.sizeOn(size);
              for (const placement of layoutWatermark(
                size,
                copy,
                spec.rotation,
                spec.position,
              )) {
                insertNewObject(
                  { api, page },
                  () => api.FPDF_NewFormObjectFromXObject(xobject),
                  (form) =>
                    check(
                      api.FPDFPageObj_AddMark(form, ARTIFACT_TAG),
                      "tag the watermark",
                    ),
                  copyMatrix(placement, natural, copy),
                  "a watermark copy",
                );
              }
              check(
                api.FPDFPage_GenerateContent(page),
                "save the watermark page",
              );
            }),
          );
        } finally {
          api.FPDF_CloseXObject(xobject);
        }
        return stamp.save();
      } finally {
        stamp.close();
      }
    } finally {
      scratch.close();
    }
  }
}

/**
 * The matrix of one copy: first scale the natural box to the copy's size,
 * then apply the layout's placement (which works in copy-size units).
 *
 * @param placement Copy space (0..copy size) to page space.
 * @param natural The drawn content's box.
 * @param copy The copy's size on this page.
 * @returns Natural space to page space.
 */
export function copyMatrix(
  placement: Matrix,
  natural: Size,
  copy: Size,
): Matrix {
  return compose(placement, [
    copy.width / natural.width,
    0,
    0,
    copy.height / natural.height,
    0,
    0,
  ]);
}
