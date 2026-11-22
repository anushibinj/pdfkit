import { PAGE_OBJECT, type ImagesPdfiumApi } from "./pdfium-api";

/**
 * How many form XObjects deep the walk goes. Real files nest a few levels
 * (a page placed inside a page, a logo inside a template); the limit only
 * guards against pathological files.
 */
export const MAX_FORM_DEPTH = 32;

/**
 * List every image object on a loaded page, in content order.
 *
 * Images are often not direct children of the page: a form XObject (a
 * reusable piece of content, e.g. an embedded page, a transparency group or
 * a stamp) holds its own list of objects. The walk is depth-first, so a
 * form's images come at the form's position in the content, which is the
 * order a reader paints them in.
 *
 * Image handles stay valid while the page is loaded; they point into the
 * page's object tree.
 *
 * @param api The PDFium module.
 * @param page A loaded `FPDF_PAGE`.
 * @returns The `FPDF_PAGEOBJECT` handles of the image objects.
 */
export function collectImageObjects(
  api: ImagesPdfiumApi,
  page: number,
): number[] {
  const images: number[] = [];
  const visit = (object: number, depth: number) => {
    const type = api.FPDFPageObj_GetType(object);
    if (type === PAGE_OBJECT.IMAGE) {
      images.push(object);
    } else if (type === PAGE_OBJECT.FORM && depth < MAX_FORM_DEPTH) {
      const count = api.FPDFFormObj_CountObjects(object);
      for (let i = 0; i < count; i++) {
        const child = api.FPDFFormObj_GetObject(object, i);
        if (child) visit(child, depth + 1);
      }
    }
  };
  const count = api.FPDFPage_CountObjects(page);
  for (let i = 0; i < count; i++) {
    const object = api.FPDFPage_GetObject(page, i);
    if (object) visit(object, 0);
  }
  return images;
}
