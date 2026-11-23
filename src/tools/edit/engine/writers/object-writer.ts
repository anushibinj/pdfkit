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
