import type { Matrix } from "@/lib/affine";
import type { EditObject } from "../../core/model";
import type { SaveImage } from "../../core/save-plan";
import type { PdfiumApi } from "../pdfium-api";
import type { WasmHeap } from "@/lib/pdfium/wasm-heap";

/** What a writer needs to add objects to one page. */
export interface WriteContext {
  api: PdfiumApi;
  heap: WasmHeap;
  /** The `FPDF_DOCUMENT` being edited. */
  doc: number;
  /** The `FPDF_PAGE` being edited. */
  page: number;
  /** Image bytes by id. */
  images: ReadonlyMap<string, SaveImage>;
}

/** Adds one kind of {@link EditObject} to a PDF page. */
export interface ObjectWriter<T extends EditObject> {
  /**
   * Draw the object on the page.
   *
   * @param object The object.
   * @param ctx The page being edited.
   */
  write(object: T, ctx: WriteContext): void;
}

/**
 * Throw when a PDFium call reports failure (`false` / 0).
 *
 * @param ok The call's result.
 * @param action What was attempted, for the message ("set the text").
 * @throws When `ok` is falsy.
 */
export function check(ok: boolean | number, action: string): void {
  if (!ok) throw new Error(`PDFium could not ${action}`);
}

/**
 * Create a page object, configure it, place it and hand it to the page.
 *
 * Ownership is the subtle part. A new page object belongs to us until
 * `FPDFPage_InsertObject`, after which the page owns it (and frees it when
 * the page is closed). So:
 * - if creation fails, there is nothing to free;
 * - if configuring fails, we must destroy the object ourselves, or it leaks;
 * - once inserted, we must never destroy it (the page would free it twice).
 * The transform is applied before inserting so a failure in it is also
 * covered by the destroy branch.
 *
 * @param ctx The page being edited.
 * @param create Makes the object; returns its handle or 0.
 * @param configure Sets colours, text, image data...; throws on failure.
 * @param matrix Where the object's own coordinates land in user space.
 * @param what Name of the object, for the error message.
 */
export function insertNewObject(
  ctx: WriteContext,
  create: () => number,
  configure: (object: number) => void,
  matrix: Matrix,
  what: string,
): void {
  const object = create();
  if (!object) throw new Error(`PDFium could not create ${what}`);
  try {
    configure(object);
    ctx.api.FPDFPageObj_Transform(object, ...matrix);
  } catch (err) {
    ctx.api.FPDFPageObj_Destroy(object);
    throw err;
  }
  ctx.api.FPDFPage_InsertObject(ctx.page, object);
}
