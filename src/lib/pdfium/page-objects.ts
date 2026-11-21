import type { Matrix } from "@/lib/affine";

/**
 * Helpers for adding new objects (text, paths, images, forms) to a PDFium
 * page, shared by every tool that draws with PDFium.
 */

/** The PDFium functions {@link insertNewObject} calls. */
export interface PageObjectApi {
  FPDFPage_InsertObject(page: number, object: number): void;
  FPDFPageObj_Transform(
    object: number,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  FPDFPageObj_Destroy(object: number): void;
}

/** A loaded page to add objects to, with the functions to do it. */
export interface ObjectTarget {
  api: PageObjectApi;
  /** The `FPDF_PAGE`. */
  page: number;
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
 * @param ctx The page to add to, and the PDFium functions to do it with.
 * @param create Makes the object; returns its handle or 0.
 * @param configure Sets colours, text, image data...; throws on failure.
 * @param matrix Where the object's own coordinates land in user space.
 * @param what Name of the object, for the error message.
 */
export function insertNewObject(
  ctx: ObjectTarget,
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
