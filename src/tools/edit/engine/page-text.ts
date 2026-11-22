import type { WasmHeap } from "@/lib/pdfium/wasm-heap";
import type { Matrix } from "../core/affine";
import type { Rgb } from "../core/model";
import {
  observedCharacters,
  type FontDescription,
  type PageChar,
  type PageTextSnapshot,
  type TextFragment,
} from "../core/text-runs";
import { PAGE_OBJECT_TEXT, type PdfiumApi } from "./pdfium-api";
import type { TextSurface } from "./text-edits";
import { check } from "./writers/object-writer";

/** Text render modes that paint glyphs and do not clip: fill, stroke, both. */
const EDITABLE_RENDER_MODES = new Set([0, 1, 2]);
/** Render mode 1 strokes the outlines only: its colour is the stroke's. */
const STROKE_ONLY = 1;
/** Where probes start, in user space: far below and left of any page. */
const PROBE_ORIGIN = -100_000;
/** Minimum distance between two probes' origins along each axis. */
const PROBE_GAP = 1_000;

/**
 * Reads and changes the text objects of one loaded page through PDFium.
 *
 * It is the PDFium implementation of {@link TextSurface}. Objects are
 * remembered by handle under the index they had when the page was read, so
 * callers can keep using those indices while objects are removed or
 * replaced (which shifts PDFium's own indices).
 *
 * Ownership: the page owns its objects. An object removed with
 * `FPDFPage_RemoveObject` belongs to the caller, and is destroyed right
 * away. A new object is destroyed only if inserting it fails; once inserted
 * the page owns it until it is removed again (probes are).
 *
 * Nothing here calls `FPDFPage_GenerateContent`: on a page loaded only to
 * render a preview, the changes are dropped when the page closes, and the
 * save path regenerates the content itself.
 */
export class PdfiumPageText implements TextSurface {
  private readonly objects = new Map<number, number>();
  private snapshot: PageTextSnapshot | null = null;

  /**
   * @param api The PDFium module.
   * @param heap Memory helper for that module.
   * @param doc The `FPDF_DOCUMENT` the page belongs to.
   * @param page A loaded `FPDF_PAGE`.
   */
  constructor(
    private readonly api: PdfiumApi,
    private readonly heap: WasmHeap,
    private readonly doc: number,
    private readonly page: number,
  ) {}

  /**
   * Read the page's text (once; later calls return the same snapshot, so
   * the result always describes the page before any change).
   *
   * PDFium's text page (`FPDFText_LoadPage`) is the character-level view
   * of the page. It is used twice:
   * - to get each text object's Unicode text (`FPDFTextObj_GetText` maps
   *   glyph codes to characters through the font's ToUnicode table);
   * - to list every character with its font, position and whether PDFium
   *   generated it, from which {@link observedCharacters} learns which
   *   characters each font really has.
   * Only text objects directly on the page are read; text inside form
   * XObjects is not editable.
   *
   * @returns Visible text fragments and observed characters per font.
   */
  read(): PageTextSnapshot {
    if (this.snapshot) return this.snapshot;
    const { api } = this;
    const textPage = api.FPDFText_LoadPage(this.page);
    if (!textPage) throw new Error("Could not read the text of this page");
    try {
      const fonts = new Map<number, FontDescription>();
      const fragments: TextFragment[] = [];
      const count = api.FPDFPage_CountObjects(this.page);
      for (let index = 0; index < count; index++) {
        const object = api.FPDFPage_GetObject(this.page, index);
        const fragment = this.readFragment(object, index, textPage, fonts);
        if (fragment) {
          fragments.push(fragment);
          this.objects.set(index, object);
        }
      }
      this.snapshot = {
        fragments,
        observed: observedCharacters(this.readChars(textPage)),
      };
      return this.snapshot;
    } finally {
      api.FPDFText_ClosePage(textPage);
    }
  }

  /**
   * Set an object's text through `FPDFText_SetText`, which encodes each
   * character with the object's own font.
   *
   * @param index The object's index from {@link read}.
   * @param text The new text.
   */
  setText(index: number, text: string): void {
    const object = this.object(index);
    this.heap.using(this.heap.utf16(text), (ptr) =>
      check(this.api.FPDFText_SetText(object, ptr), "change the text"),
    );
  }

  /**
   * Swap an object for a new text object in a standard font.
   *
   * The new object copies the original's matrix (position, scale, rotation
   * and skew, page transform included), `Tf` size, render mode, fill and
   * stroke colours and stroke width, and is inserted at the original's
   * current position in the content order, so it is painted exactly where
   * and when the original was (above what was beneath it, beneath what was
   * above it).
   *
   * @param index The original object's index from {@link read}.
   * @param fontName A standard font name, e.g. "Helvetica-Bold".
   * @param text The text to write.
   */
  replace(index: number, fontName: string, text: string): void {
    const { api, heap } = this;
    const original = this.object(index);
    const fragment = this.fragment(index);
    const created = api.FPDFPageObj_NewTextObj(
      this.doc,
      fontName,
      fragment.fontSize,
    );
    if (!created) throw new Error("PDFium could not create a text object");
    try {
      heap.using(heap.utf16(text), (ptr) =>
        check(api.FPDFText_SetText(created, ptr), "write the text"),
      );
      heap.using(heap.alloc(24), (matrix) => {
        check(api.FPDFPageObj_GetMatrix(original, matrix), "read the matrix");
        check(api.FPDFPageObj_SetMatrix(created, matrix), "place the text");
      });
      this.copyPaint(original, created, fragment.renderMode);
      check(
        api.FPDFPage_InsertObjectAtIndex(
          this.page,
          created,
          this.currentPosition(original),
        ),
        "add the text to the page",
      );
    } catch (err) {
      // Not inserted, so the page does not own it: free it here.
      api.FPDFPageObj_Destroy(created);
      throw err;
    }
    this.remove(index);
    this.objects.set(index, created);
  }

  /**
   * Remove an object from the page and free it.
   *
   * @param index The object's index from {@link read}.
   */
  remove(index: number): void {
    const object = this.object(index);
    check(this.api.FPDFPage_RemoveObject(this.page, object), "remove text");
    this.objects.delete(index);
    // Removal hands ownership to us; nothing else will free it.
    this.api.FPDFPageObj_Destroy(object);
  }

  /**
   * Find out what PDFium makes of texts written in fragments' fonts,
   * leaving the page as it was.
   *
   * For each request, a temporary text object is created in the
   * fragment's own font (`FPDFPageObj_CreateTextObj` takes the font
   * handle, embedded subset included) and size, given the text with
   * `FPDFText_SetText` (the same encoding step an in-place edit uses), and
   * added to the page. One text page is then built and each temporary
   * object's text read back. The temporary objects are always removed and
   * freed again, even if something fails.
   *
   * Placement matters: PDFium's text extraction drops a text object that
   * repeats another one at the same position (it treats it as a fake-bold
   * double print; verified: a probe identical to a line on the page read
   * back empty). So each probe keeps the fragment's orientation and scale
   * but sits far outside the page, on its own diagonal slot, spaced by
   * more than the text can be long, so no two probes and no real text
   * share a place.
   *
   * @param requests Fragment indices from {@link read}, with texts.
   * @returns The extracted text per fragment index.
   */
  probe(
    requests: readonly { index: number; text: string }[],
  ): Map<number, string> {
    const { api, heap } = this;
    const created: { index: number; object: number }[] = [];
    try {
      let offset = PROBE_ORIGIN;
      for (const { index, text } of requests) {
        const fragment = this.fragment(index);
        const font = api.FPDFTextObj_GetFont(this.object(index));
        const object = api.FPDFPageObj_CreateTextObj(
          this.doc,
          font,
          fragment.fontSize,
        );
        if (!object) throw new Error("PDFium could not create a text object");
        try {
          heap.using(heap.utf16(text), (ptr) =>
            check(api.FPDFText_SetText(object, ptr), "write the text"),
          );
          const [a, b, c, d] = fragment.matrix;
          heap.using(heap.floats([a, b, c, d, offset, offset]), (matrix) =>
            check(api.FPDFPageObj_SetMatrix(object, matrix), "place the text"),
          );
        } catch (err) {
          api.FPDFPageObj_Destroy(object);
          throw err;
        }
        api.FPDFPage_InsertObject(this.page, object);
        created.push({ index, object });
        // Next slot: beyond the longest this text can be (two ems per
        // character, in user space, whatever the orientation).
        const em =
          fragment.fontSize *
          fragment.matrix.slice(0, 4).reduce((sum, v) => sum + Math.abs(v), 0);
        offset -= PROBE_GAP + 2 * em * (text.length + 1);
      }
      const textPage = api.FPDFText_LoadPage(this.page);
      if (!textPage) throw new Error("Could not read the text of this page");
      try {
        return new Map(
          created.map(({ index, object }) => [
            index,
            this.objectText(object, textPage),
          ]),
        );
      } finally {
        api.FPDFText_ClosePage(textPage);
      }
    } finally {
      for (const { object } of created) {
        // Removing hands the object back to us, so it can be freed. If PDFium
        // refused, the page still owns it: freeing it would free it twice.
        check(api.FPDFPage_RemoveObject(this.page, object), "remove a probe");
        api.FPDFPageObj_Destroy(object);
      }
    }
  }

  /**
   * Read one page object as a {@link TextFragment}.
   *
   * @param object The page object.
   * @param index Its index on the page.
   * @param textPage The page's text page.
   * @param fonts Font descriptions read so far, by font handle.
   * @returns The fragment, or `null` for anything that is not visible,
   *   editable text (other object types, invisible or clipping text, text
   *   that is only whitespace).
   */
  private readFragment(
    object: number,
    index: number,
    textPage: number,
    fonts: Map<number, FontDescription>,
  ): TextFragment | null {
    const { api, heap } = this;
    if (!object || api.FPDFPageObj_GetType(object) !== PAGE_OBJECT_TEXT)
      return null;
    const renderMode = api.FPDFTextObj_GetTextRenderMode(object);
    if (!EDITABLE_RENDER_MODES.has(renderMode)) return null;
    const font = api.FPDFTextObj_GetFont(object);
    if (!font) return null;
    const text = this.objectText(object, textPage);
    if (text.trim() === "") return null;
    const fontSize = heap.using(heap.alloc(4), (ptr) =>
      api.FPDFTextObj_GetFontSize(object, ptr) ? heap.readFloats(ptr, 1)[0] : 0,
    );
    if (!(fontSize > 0)) return null;
    // FS_MATRIX: six floats a, b, c, d, e, f.
    const matrix = heap.using(heap.alloc(24), (ptr): Matrix | null => {
      if (!api.FPDFPageObj_GetMatrix(object, ptr)) return null;
      const [a, b, c, d, e, f] = heap.readFloats(ptr, 6);
      return [a, b, c, d, e, f];
    });
    // GetBounds writes left, bottom, right, top through four pointers.
    const bounds = heap.using(heap.alloc(16), (ptr) =>
      api.FPDFPageObj_GetBounds(object, ptr, ptr + 4, ptr + 8, ptr + 12)
        ? heap.readFloats(ptr, 4)
        : null,
    );
    if (!matrix || !bounds) return null;
    let description = fonts.get(font);
    if (!description) {
      description = this.describeFont(font);
      fonts.set(font, description);
    }
    const [left, bottom, right, top] = bounds;
    return {
      index,
      text,
      fontKey: font,
      font: description,
      fontSize,
      matrix,
      bounds: { left, bottom, right, top },
      color: this.color(object, renderMode === STROKE_ONLY),
      renderMode,
    };
  }

  /**
   * Read every character of the text page for {@link observedCharacters}.
   *
   * @param textPage The page's text page.
   * @returns The characters, in text-page order.
   */
  private readChars(textPage: number): PageChar[] {
    const { api, heap } = this;
    const count = api.FPDFText_CountChars(textPage);
    return heap.using(heap.alloc(16), (origin) => {
      const chars: PageChar[] = [];
      for (let i = 0; i < count; i++) {
        const object = api.FPDFText_GetTextObject(textPage, i);
        const font = object ? api.FPDFTextObj_GetFont(object) : 0;
        const code = api.FPDFText_GetUnicode(textPage, i);
        // Skip characters with no object or font, and code points that are
        // not valid Unicode scalar values (fromCodePoint would throw).
        if (!font || code <= 0 || code > 0x10ffff) continue;
        if (code >= 0xd800 && code <= 0xdfff) continue;
        const [x, y] = api.FPDFText_GetCharOrigin(
          textPage,
          i,
          origin,
          origin + 8,
        )
          ? heap.readDoubles(origin, 2)
          : [Number.NaN, Number.NaN];
        chars.push({
          char: String.fromCodePoint(code),
          generated: api.FPDFText_IsGenerated(textPage, i) === 1,
          fontKey: font,
          x,
          y,
        });
      }
      return chars;
    });
  }

  /**
   * Describe a font for style matching and the subset check.
   *
   * @param font An `FPDF_FONT`.
   * @returns Its name, family, flags, weight, italic angle and embedding.
   */
  private describeFont(font: number): FontDescription {
    const { api, heap } = this;
    const italicAngle = heap.using(heap.alloc(4), (ptr) =>
      api.FPDFFont_GetItalicAngle(font, ptr) ? heap.readInts(ptr, 1)[0] : 0,
    );
    return {
      baseName: heap.readString(
        (buf, len) => api.FPDFFont_GetBaseFontName(font, buf, len),
        "utf8",
      ),
      family: heap.readString(
        (buf, len) => api.FPDFFont_GetFamilyName(font, buf, len),
        "utf8",
      ),
      flags: api.FPDFFont_GetFlags(font),
      weight: api.FPDFFont_GetWeight(font),
      italicAngle,
      embedded: api.FPDFFont_GetIsEmbedded(font) === 1,
    };
  }

  /**
   * Read an object's fill or stroke colour.
   *
   * @param object The page object.
   * @param stroke Read the stroke colour instead of the fill.
   * @returns The colour (black if PDFium cannot say).
   */
  private color(object: number, stroke: boolean): Rgb {
    const { api, heap } = this;
    return heap.using(heap.alloc(16), (ptr) => {
      const ok = stroke
        ? api.FPDFPageObj_GetStrokeColor(
            object,
            ptr,
            ptr + 4,
            ptr + 8,
            ptr + 12,
          )
        : api.FPDFPageObj_GetFillColor(object, ptr, ptr + 4, ptr + 8, ptr + 12);
      if (!ok) return { r: 0, g: 0, b: 0 };
      const [r, g, b] = heap.readInts(ptr, 3);
      return { r, g, b };
    });
  }

  /**
   * Give a new object the original's render mode, colours and stroke width.
   * Alpha is copied too, so semi-transparent text stays semi-transparent.
   *
   * @param from The original object.
   * @param to The new object.
   * @param renderMode The original's render mode.
   */
  private copyPaint(from: number, to: number, renderMode: number): void {
    const { api, heap } = this;
    heap.using(heap.alloc(16), (ptr) => {
      const rgba = (): [number, number, number, number] => {
        const [r, g, b, a] = heap.readInts(ptr, 4);
        return [r, g, b, a];
      };
      if (api.FPDFPageObj_GetFillColor(from, ptr, ptr + 4, ptr + 8, ptr + 12))
        api.FPDFPageObj_SetFillColor(to, ...rgba());
      if (api.FPDFPageObj_GetStrokeColor(from, ptr, ptr + 4, ptr + 8, ptr + 12))
        api.FPDFPageObj_SetStrokeColor(to, ...rgba());
      if (api.FPDFPageObj_GetStrokeWidth(from, ptr))
        api.FPDFPageObj_SetStrokeWidth(to, heap.readFloats(ptr, 1)[0]);
    });
    check(api.FPDFTextObj_SetTextRenderMode(to, renderMode), "style the text");
  }

  /**
   * An object's text through the given text page (UTF-16, two-call).
   *
   * @param object A text object on this page.
   * @param textPage A text page built from this page.
   * @returns The text.
   */
  private objectText(object: number, textPage: number): string {
    return this.heap.readString(
      (buf, len) => this.api.FPDFTextObj_GetText(object, textPage, buf, len),
      "utf16",
    );
  }

  /**
   * Where an object is now in the page's object list. Removing objects
   * shifts later indices, so this is looked up rather than remembered.
   *
   * @param object A page object on this page.
   * @returns Its current index.
   * @throws When the object is not on the page.
   */
  private currentPosition(object: number): number {
    const count = this.api.FPDFPage_CountObjects(this.page);
    for (let i = 0; i < count; i++) {
      if (this.api.FPDFPage_GetObject(this.page, i) === object) return i;
    }
    throw new Error("The text object is no longer on the page");
  }

  /**
   * @param index An index from {@link read}.
   * @returns The fragment read under that index.
   * @throws When nothing was read under it.
   */
  private fragment(index: number): TextFragment {
    const fragment = this.snapshot?.fragments.find((f) => f.index === index);
    if (!fragment) throw new Error(`Text object ${index} was not read`);
    return fragment;
  }

  /**
   * @param index An index from {@link read}.
   * @returns The object now stored under it.
   * @throws When there is none (never read, or already removed).
   */
  private object(index: number): number {
    const object = this.objects.get(index);
    if (!object) throw new Error(`There is no text object ${index}`);
    return object;
  }
}
