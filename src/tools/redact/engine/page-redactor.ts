import type { Matrix } from "@/lib/affine";
import type { PageBox, PageInfo } from "@/lib/pdfium/page-box";
import { check } from "@/lib/pdfium/page-objects";
import type { PdfiumDocument } from "@/lib/pdfium/pdfium-document";
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import { lineWidth, stripUnsupported, type FontMetricsSource } from "@/tools/edit/core/text-layout";
import {
  describeFontStyle,
  originalFontCanWrite,
  standardFontFor,
  type TextFragment,
} from "@/tools/edit/core/text-runs";
import { PdfiumPageText } from "@/tools/edit/engine/page-text";
import { FILL_MODE } from "@/tools/edit/engine/pdfium-api";
import { sameGlyphs } from "@/tools/edit/engine/text-edits";
import { computeImageRedactionPixels, imageUserBounds } from "../core/image-redaction-math";
import type { RedactionMarkStyle } from "../core/model";
import {
  boxesOverlap,
  splitTextObjectByBoxes,
  type KeptTextSpan,
} from "../core/text-search";
import { readPageCharsWithBoxes } from "./page-text-extractor";
import {
  ANNOT_SUBTYPE_WIDGET,
  PAGE_OBJECT_IMAGE,
  PAGE_OBJECT_PATH,
  type RedactPdfiumApi,
} from "./redact-pdfium-api";

/** Per-page counts of objects surgically modified or removed. */
export interface PageRedactionStats {
  textObjectsRemoved: number;
  textObjectsSplit: number;
  imagesModified: number;
  pathsRemoved: number;
  annotationsRemoved: number;
}

/** Maximum rasterisation edge (pixels) to avoid exhausting browser WASM memory. */
const MAX_RASTER_SIDE = 2400;
/** Default rasterisation DPI when the maximum-certainty fallback is enabled. */
const RASTER_DPI = 200;

/**
 * Surgically redact all text, image pixels, vector paths, and annotations
 * intersecting `boxes` on one loaded PDFium page, then draw opaque redaction
 * marks (and optional labels).
 */
export class PageRedactor {
  /**
   * @param api PDFium module interface.
   * @param heap WASM heap helper.
   * @param metrics Standard font metrics used for fallback text and overlay labels.
   */
  constructor(
    private readonly api: RedactPdfiumApi,
    private readonly heap: WasmHeap,
    private readonly metrics: FontMetricsSource,
  ) {}

  /**
   * Apply permanent redactions to `page` inside `doc`.
   *
   * Order of operations:
   * 1. Snapshot character geometry and text fragments, then remove or split
   *    text objects whose glyphs fall inside `boxes`.
   * 2. Decode overlapping image bitmaps, blank only the pixels under `boxes`,
   *    and replace each image via copy-on-write so shared images elsewhere stay intact.
   * 3. Remove overlapping vector path objects contained in or substantially
   *    covered by `boxes`.
   * 4. Clear form values and remove overlapping annotations/links.
   * 5. Draw solid black or white redaction rectangles and optional centered labels.
   * 6. Call `FPDFPage_GenerateContent` so changes persist to the PDF content stream.
   *
   * @param doc Open `FPDF_DOCUMENT` handle.
   * @param page Loaded `FPDF_PAGE` handle.
   * @param pageInfo Page bounding box in user space.
   * @param boxes Redaction boxes on this page.
   * @param style Visual fill and optional overlay label.
   * @returns Counts of removed/modified objects.
   */
  redactPage(
    doc: number,
    page: number,
    pageInfo: PageInfo,
    boxes: readonly PageBox[],
    style: RedactionMarkStyle,
  ): PageRedactionStats {
    const stats: PageRedactionStats = {
      textObjectsRemoved: 0,
      textObjectsSplit: 0,
      imagesModified: 0,
      pathsRemoved: 0,
      annotationsRemoved: 0,
    };
    if (boxes.length === 0) return stats;

    // 1. Snapshot original page object handles and their types up front before
    // any removal/destruction shifts indices or invalidates C++ pointers.
    const initialCount = this.api.FPDFPage_CountObjects(page);
    const initialObjects = Array.from({ length: initialCount }, (_, i) =>
      this.api.FPDFPage_GetObject(page, i),
    );
    const imageObjects: number[] = [];
    const pathObjects: number[] = [];
    for (const obj of initialObjects) {
      if (!obj) continue;
      const kind = this.api.FPDFPageObj_GetType(obj);
      if (kind === PAGE_OBJECT_IMAGE) imageObjects.push(obj);
      else if (kind === PAGE_OBJECT_PATH) pathObjects.push(obj);
    }

    const textResult = this.redactTextObjects(
      doc,
      page,
      initialObjects,
      boxes,
    );
    stats.textObjectsRemoved = textResult.removed;
    stats.textObjectsSplit = textResult.split;

    // 2. Blank image pixels under redaction boxes (copy-on-write per object).
    stats.imagesModified = this.redactImageObjects(
      doc,
      page,
      imageObjects,
      boxes,
      style,
    );

    // 3. Remove vector paths enclosed by or predominantly covered by redaction boxes.
    stats.pathsRemoved = this.redactPathObjects(
      page,
      pathObjects,
      pageInfo.box,
      boxes,
    );

    // 4. Remove overlapping annotations / links and clear widget values.
    stats.annotationsRemoved = this.redactAnnotations(page, boxes);

    // 5. Paint solid redaction rectangles + optional label text.
    this.drawRedactionMarks(doc, page, boxes, style);

    // 6. Persist modified object list into the page content stream.
    check(this.api.FPDFPage_GenerateContent(page), "save redacted page content");
    return stats;
  }

  /**
   * Maximum-certainty fallback: flatten an entire already-redacted page into a
   * raster bitmap image so zero original fonts, paths, or hidden content streams
   * survive on that page.
   *
   * Renders directly into an `FPDF_BITMAP` (in PDFium's native BGRx/BGRA layout
   * with `FPDF_ANNOT = 0x01`) and embeds it via `FPDFImageObj_SetBitmap`,
   * avoiding PNG re-encoding overhead and working identically in workers and Node.
   *
   * @param doc Open {@link PdfiumDocument}.
   * @param pageIndex Zero-based page index.
   * @param pageInfo Page dimensions and rotation.
   */
  rasterizePage(
    doc: PdfiumDocument,
    pageIndex: number,
    pageInfo: PageInfo,
  ): void {
    const pageW = Math.max(1, pageInfo.box.right - pageInfo.box.left);
    const pageH = Math.max(1, pageInfo.box.top - pageInfo.box.bottom);
    const scale = Math.min(
      RASTER_DPI / 72,
      MAX_RASTER_SIDE / Math.max(pageW, pageH),
    );
    const width = Math.max(1, Math.round(pageW * scale));
    const height = Math.max(1, Math.round(pageH * scale));

    doc.withPage(pageIndex, (page) => {
      const bitmap = this.api.FPDFBitmap_Create(width, height, 0);
      if (!bitmap) {
        throw new RangeError("out of memory: could not rasterise page");
      }
      try {
        this.api.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
        // FPDF_ANNOT (0x01) renders any remaining annotations onto the bitmap;
        // native byte order (no FPDF_REVERSE_BYTE_ORDER) is expected by SetBitmap.
        this.api.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0x01);

        // Remove every remaining page object.
        for (let i = this.api.FPDFPage_CountObjects(page) - 1; i >= 0; i--) {
          const obj = this.api.FPDFPage_GetObject(page, i);
          if (obj && this.api.FPDFPage_RemoveObject(page, obj)) {
            this.api.FPDFPageObj_Destroy(obj);
          }
        }
        // Remove every remaining annotation.
        for (let i = this.api.FPDFPage_GetAnnotCount(page) - 1; i >= 0; i--) {
          this.api.FPDFPage_RemoveAnnot(page, i);
        }

        // Reset page rotation since FPDF_RenderPageBitmap(..., 0, ...) already
        // baked the page's `/Rotate` into the bitmap.
        if (pageInfo.rotation !== 0) {
          this.api.FPDFPage_SetRotation(page, 0);
        }

        const imageObj = this.api.FPDFPageObj_NewImageObj(doc.handle);
        if (!imageObj) {
          throw new Error("PDFium could not create rasterised image");
        }
        try {
          check(
            this.api.FPDFImageObj_SetBitmap(0, 0, imageObj, bitmap),
            "embed rasterised page bitmap",
          );
          // Map the unit square [0, 1]^2 onto the full page bounding box.
          this.heap.using(
            this.heap.floats([
              pageW,
              0,
              0,
              pageH,
              pageInfo.box.left,
              pageInfo.box.bottom,
            ]),
            (matPtr) =>
              check(
                this.api.FPDFPageObj_SetMatrix(imageObj, matPtr),
                "place rasterised page image",
              ),
          );
          this.api.FPDFPage_InsertObject(page, imageObj);
        } catch (err) {
          this.api.FPDFPageObj_Destroy(imageObj);
          throw err;
        }

        check(
          this.api.FPDFPage_GenerateContent(page),
          "save rasterised page content",
        );
      } finally {
        this.api.FPDFBitmap_Destroy(bitmap);
      }
    });
  }

  /** Remove or split text objects whose glyphs overlap any redaction box. */
  private redactTextObjects(
    doc: number,
    page: number,
    initialObjects: readonly number[],
    boxes: readonly PageBox[],
  ): { removed: number; split: number } {
    const surface = new PdfiumPageText(this.api, this.heap, doc, page);
    const snapshot = surface.read();
    const chars = readPageCharsWithBoxes(this.api, this.heap, page);
    const actions = splitTextObjectByBoxes(snapshot.fragments, chars, boxes);

    const fragmentsByIndex = new Map<number, TextFragment>(
      snapshot.fragments.map((f) => [f.index, f]),
    );

    // Probe candidate split spans in the original font before mutating objects.
    const probeRequests: { index: number; text: string }[] = [];
    const spanProbeKey = (fragIdx: number, spanIdx: number) =>
      `${fragIdx}:${spanIdx}`;
    const candidateProbeMap = new Map<string, number>();

    for (const action of actions) {
      if (action.kind !== "split") continue;
      const fragment = fragmentsByIndex.get(action.fragmentIndex);
      if (!fragment) continue;
      const observed = snapshot.observed.get(fragment.fontKey) ?? new Set();
      // Probe using the combined surviving text to keep one probe per split fragment.
      const combinedText = action.spans.map((s) => s.text).join("");
      if (
        combinedText.length > 0 &&
        originalFontCanWrite(combinedText, fragment.font, observed, this.metrics)
      ) {
        probeRequests.push({ index: fragment.index, text: combinedText });
        candidateProbeMap.set(
          spanProbeKey(fragment.index, 0),
          fragment.index,
        );
      }
    }

    const probed =
      probeRequests.length > 0 ? surface.probe(probeRequests) : new Map<number, string>();

    let removed = 0;
    let split = 0;

    for (const action of actions) {
      if (action.kind === "keep") continue;
      const origObj = initialObjects[action.fragmentIndex];
      if (!origObj) continue;

      if (action.kind === "remove") {
        if (this.api.FPDFPage_RemoveObject(page, origObj)) {
          this.api.FPDFPageObj_Destroy(origObj);
          removed++;
        }
        continue;
      }

      const fragment = fragmentsByIndex.get(action.fragmentIndex);
      if (!fragment) continue;
      const combinedText = action.spans.map((s) => s.text).join("");
      const keepOriginalFont =
        candidateProbeMap.has(spanProbeKey(fragment.index, 0)) &&
        sameGlyphs(probed.get(fragment.index) ?? "", combinedText);

      const insertAt = this.currentObjectPosition(page, origObj);
      if (insertAt < 0) continue;

      let offset = 0;
      for (const span of action.spans) {
        const created = this.createSurvivingSpanObject(
          doc,
          origObj,
          fragment,
          span,
          keepOriginalFont,
        );
        if (!created) continue;
        if (
          this.api.FPDFPage_InsertObjectAtIndex(page, created, insertAt + offset)
        ) {
          offset++;
        } else {
          this.api.FPDFPageObj_Destroy(created);
        }
      }

      if (this.api.FPDFPage_RemoveObject(page, origObj)) {
        this.api.FPDFPageObj_Destroy(origObj);
      }
      split++;
    }

    return { removed, split };
  }

  /**
   * Create a new PDFium text object for one surviving span of a split line,
   * preserving the original font when verified by `probe` or falling back to
   * the closest standard PDF font at the exact span origin.
   */
  private createSurvivingSpanObject(
    doc: number,
    origObj: number,
    fragment: TextFragment,
    span: KeptTextSpan,
    keepOriginalFont: boolean,
  ): number {
    const { api, heap } = this;
    const style = describeFontStyle(fragment.font);
    const stdFont = standardFontFor(style);
    const textToWrite = keepOriginalFont
      ? span.text
      : stripUnsupported(span.text, style.family, this.metrics).text;
    if (textToWrite.trim().length === 0) return 0;

    const origFont = keepOriginalFont ? api.FPDFTextObj_GetFont(origObj) : 0;
    const created =
      keepOriginalFont && origFont
        ? api.FPDFPageObj_CreateTextObj(doc, origFont, fragment.fontSize)
        : api.FPDFPageObj_NewTextObj(doc, stdFont, fragment.fontSize);
    if (!created) return 0;

    try {
      heap.using(heap.utf16(textToWrite), (ptr) =>
        check(api.FPDFText_SetText(created, ptr), "write split text"),
      );
      const [a, b, c, d] = fragment.matrix;
      heap.using(heap.floats([a, b, c, d, span.originX, span.originY]), (m) =>
        check(api.FPDFPageObj_SetMatrix(created, m), "place split text"),
      );
      this.copyTextPaint(origObj, created, fragment.renderMode);
      return created;
    } catch (err) {
      api.FPDFPageObj_Destroy(created);
      throw err;
    }
  }

  /** Copy fill, stroke, stroke width, and render mode onto a split text object. */
  private copyTextPaint(from: number, to: number, renderMode: number): void {
    const { api, heap } = this;
    heap.using(heap.alloc(16), (ptr) => {
      const readRgba = (): [number, number, number, number] => {
        const [r, g, b, a] = heap.readInts(ptr, 4);
        return [r, g, b, a];
      };
      if (api.FPDFPageObj_GetFillColor(from, ptr, ptr + 4, ptr + 8, ptr + 12)) {
        api.FPDFPageObj_SetFillColor(to, ...readRgba());
      }
      if (
        api.FPDFPageObj_GetStrokeColor(from, ptr, ptr + 4, ptr + 8, ptr + 12)
      ) {
        api.FPDFPageObj_SetStrokeColor(to, ...readRgba());
      }
      if (api.FPDFPageObj_GetStrokeWidth(from, ptr)) {
        api.FPDFPageObj_SetStrokeWidth(to, heap.readFloats(ptr, 1)[0]);
      }
    });
    api.FPDFTextObj_SetTextRenderMode(to, renderMode);
  }

  /**
   * Blank only the pixels covered by `boxes` inside each overlapping image
   * bitmap, and replace the image object via copy-on-write so shared image
   * XObjects on other pages or positions are unaffected.
   */
  private redactImageObjects(
    doc: number,
    page: number,
    imageObjects: readonly number[],
    boxes: readonly PageBox[],
    style: RedactionMarkStyle,
  ): number {
    const { api, heap } = this;
    const fillHex = style.fill === "white" ? 0xffffffff : 0xff000000;
    let modified = 0;

    for (const obj of imageObjects) {
      if (!obj) {
        continue;
      }

      const matrix = heap.using(heap.alloc(24), (ptr): Matrix | null => {
        if (!api.FPDFPageObj_GetMatrix(obj, ptr)) return null;
        const [a, b, c, d, e, f] = heap.readFloats(ptr, 6);
        return [a, b, c, d, e, f];
      });
      if (!matrix) continue;

      const imgBounds = imageUserBounds(matrix);
      if (!boxes.some((b) => boxesOverlap(imgBounds, b))) continue;

      const bitmap = api.FPDFImageObj_GetBitmap(obj);
      if (!bitmap) continue;

      try {
        const w = api.FPDFBitmap_GetWidth(bitmap);
        const h = api.FPDFBitmap_GetHeight(bitmap);
        const { rects, points } = computeImageRedactionPixels(
          matrix,
          w,
          h,
          boxes,
        );
        if (rects.length === 0 && points.length === 0) continue;

        for (const r of rects) {
          api.FPDFBitmap_FillRect(bitmap, r.left, r.top, r.width, r.height, fillHex);
        }

        // Batch contiguous horizontal pixels on rotated images to minimize FFI calls.
        if (points.length > 0) {
          let runStartX = points[0].x;
          let runY = points[0].y;
          let runLen = 1;
          for (let i = 1; i < points.length; i++) {
            const p = points[i];
            if (p.y === runY && p.x === runStartX + runLen) {
              runLen++;
            } else {
              api.FPDFBitmap_FillRect(bitmap, runStartX, runY, runLen, 1, fillHex);
              runStartX = p.x;
              runY = p.y;
              runLen = 1;
            }
          }
          api.FPDFBitmap_FillRect(bitmap, runStartX, runY, runLen, 1, fillHex);
        }

        const pos = this.currentObjectPosition(page, obj);
        if (pos < 0) continue;

        const newImg = api.FPDFPageObj_NewImageObj(doc);
        if (!newImg) continue;
        try {
          check(
            api.FPDFImageObj_SetBitmap(0, 0, newImg, bitmap),
            "write redacted image bitmap",
          );
          heap.using(heap.floats([...matrix]), (mPtr) =>
            check(
              api.FPDFPageObj_SetMatrix(newImg, mPtr),
              "place redacted image",
            ),
          );
          check(
            api.FPDFPage_InsertObjectAtIndex(page, newImg, pos),
            "insert redacted image",
          );
        } catch (err) {
          api.FPDFPageObj_Destroy(newImg);
          throw err;
        }

        if (api.FPDFPage_RemoveObject(page, obj)) {
          api.FPDFPageObj_Destroy(obj);
        }
        modified++;
      } finally {
        api.FPDFBitmap_Destroy(bitmap);
      }
    }

    return modified;
  }

  /** Remove vector paths enclosed by or substantially covered by redaction boxes. */
  private redactPathObjects(
    page: number,
    pathObjects: readonly number[],
    pageBox: PageBox,
    boxes: readonly PageBox[],
  ): number {
    const { api, heap } = this;
    const pageW = Math.max(1, pageBox.right - pageBox.left);
    const pageH = Math.max(1, pageBox.top - pageBox.bottom);
    let removed = 0;

    for (const obj of pathObjects) {
      if (!obj) {
        continue;
      }
      const bounds = heap.using(heap.alloc(16), (ptr): PageBox | null => {
        if (!api.FPDFPageObj_GetBounds(obj, ptr, ptr + 4, ptr + 8, ptr + 12)) {
          return null;
        }
        const [left, bottom, right, top] = heap.readFloats(ptr, 4);
        return {
          left: Math.min(left, right),
          bottom: Math.min(bottom, top),
          right: Math.max(left, right),
          top: Math.max(bottom, top),
        };
      });
      if (!bounds) continue;

      const pathW = bounds.right - bounds.left;
      const pathH = bounds.top - bounds.bottom;
      // Preserve full-page background fills/borders unless enclosed.
      const isFullPageBg = pathW > pageW * 0.85 && pathH > pageH * 0.85;
      if (isFullPageBg) continue;

      const shouldRemove = boxes.some((b) => {
        if (!boxesOverlap(bounds, b)) return false;
        const enclosed =
          bounds.left >= b.left - 0.5 &&
          bounds.right <= b.right + 0.5 &&
          bounds.bottom >= b.bottom - 0.5 &&
          bounds.top <= b.top + 0.5;
        if (enclosed) return true;
        const ix = Math.max(
          0,
          Math.min(bounds.right, b.right) - Math.max(bounds.left, b.left),
        );
        const iy = Math.max(
          0,
          Math.min(bounds.top, b.top) - Math.max(bounds.bottom, b.bottom),
        );
        const area = Math.max(1e-6, pathW * pathH);
        return (ix * iy) / area >= 0.6;
      });

      if (shouldRemove && api.FPDFPage_RemoveObject(page, obj)) {
        api.FPDFPageObj_Destroy(obj);
        removed++;
      }
    }

    return removed;
  }

  /** Clear form values on overlapping widgets and remove overlapping annotations. */
  private redactAnnotations(page: number, boxes: readonly PageBox[]): number {
    const { api, heap } = this;
    const count = api.FPDFPage_GetAnnotCount(page);
    let removed = 0;

    for (let i = count - 1; i >= 0; i--) {
      const annot = api.FPDFPage_GetAnnot(page, i);
      if (!annot) continue;
      let shouldRemove = false;
      try {
        const annotBox = heap.using(heap.alloc(16), (ptr): PageBox | null => {
          if (!api.FPDFAnnot_GetRect(annot, ptr)) return null;
          // FS_RECTF: left, top, right, bottom.
          const [left, top, right, bottom] = heap.readFloats(ptr, 4);
          return {
            left: Math.min(left, right),
            bottom: Math.min(bottom, top),
            right: Math.max(left, right),
            top: Math.max(bottom, top),
          };
        });
        if (annotBox && boxes.some((b) => boxesOverlap(annotBox, b))) {
          if (api.FPDFAnnot_GetSubtype(annot) === ANNOT_SUBTYPE_WIDGET) {
            heap.using(heap.utf16(""), (emptyPtr) => {
              api.FPDFAnnot_SetStringValue(annot, "V", emptyPtr);
            });
          }
          shouldRemove = true;
        }
      } finally {
        api.FPDFPage_CloseAnnot(annot);
      }

      if (shouldRemove && api.FPDFPage_RemoveAnnot(page, i)) {
        removed++;
      }
    }

    return removed;
  }

  /** Draw solid black/white redaction boxes and optional centered label text. */
  private drawRedactionMarks(
    doc: number,
    page: number,
    boxes: readonly PageBox[],
    style: RedactionMarkStyle,
  ): void {
    const { api, heap } = this;
    const isWhite = style.fill === "white";
    const fillRgb = isWhite ? 255 : 0;
    const textRgb = isWhite ? 0 : 255;
    const rawLabel = style.label.trim();
    const cleanLabel = stripUnsupported(rawLabel, "sans", this.metrics).text;

    for (const box of boxes) {
      const w = Math.max(0.5, box.right - box.left);
      const h = Math.max(0.5, box.top - box.bottom);
      const rect = api.FPDFPageObj_CreateNewRect(box.left, box.bottom, w, h);
      if (!rect) throw new Error("PDFium could not create redaction rectangle");
      try {
        check(
          api.FPDFPageObj_SetFillColor(rect, fillRgb, fillRgb, fillRgb, 255),
          "set redaction box fill",
        );
        if (isWhite) {
          check(
            api.FPDFPageObj_SetStrokeColor(rect, 0, 0, 0, 255),
            "set white redaction border colour",
          );
          check(
            api.FPDFPageObj_SetStrokeWidth(rect, 0.5),
            "set white redaction border width",
          );
        }
        check(
          api.FPDFPath_SetDrawMode(rect, FILL_MODE.WINDING, isWhite),
          "set redaction draw mode",
        );
        api.FPDFPage_InsertObject(page, rect);
      } catch (err) {
        api.FPDFPageObj_Destroy(rect);
        throw err;
      }

      if (cleanLabel.length === 0) continue;

      const fontMetrics = this.metrics.metrics("sans");
      const unitWidth = Math.max(1, lineWidth(cleanLabel, fontMetrics, 1));
      const maxSizeByHeight = h * 0.65;
      const maxSizeByWidth = (w * 0.85) / unitWidth;
      const fontSize = Math.min(12, maxSizeByHeight, maxSizeByWidth);
      if (fontSize < 2.5) continue;

      const labelWidth = lineWidth(cleanLabel, fontMetrics, fontSize);
      const tx = box.left + (w - labelWidth) / 2;
      const ty = box.bottom + (h - fontSize * 0.72) / 2;

      const labelObj = api.FPDFPageObj_NewTextObj(
        doc,
        "Helvetica-Bold",
        fontSize,
      );
      if (!labelObj) continue;
      try {
        heap.using(heap.utf16(cleanLabel), (ptr) =>
          check(api.FPDFText_SetText(labelObj, ptr), "set redaction label"),
        );
        check(
          api.FPDFPageObj_SetFillColor(labelObj, textRgb, textRgb, textRgb, 255),
          "set redaction label colour",
        );
        heap.using(heap.floats([1, 0, 0, 1, tx, ty]), (mPtr) =>
          check(
            api.FPDFPageObj_SetMatrix(labelObj, mPtr),
            "place redaction label",
          ),
        );
        api.FPDFPage_InsertObject(page, labelObj);
      } catch (err) {
        api.FPDFPageObj_Destroy(labelObj);
        throw err;
      }
    }
  }

  private currentObjectPosition(page: number, object: number): number {
    const count = this.api.FPDFPage_CountObjects(page);
    for (let i = 0; i < count; i++) {
      if (this.api.FPDFPage_GetObject(page, i) === object) return i;
    }
    return -1;
  }
}
