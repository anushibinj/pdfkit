import { FPDF_ERR, RENDER_FLAGS, type PdfiumCoreApi } from "./core-api";
import { isQuarterTurns, type PageInfo, type QuarterTurns } from "./page-box";
export type { PageInfo } from "./page-box";
import type { WasmHeap } from "./wasm-heap";

/** Why a file could not be opened, from PDFium's error code. */
export type OpenFailure = "password" | "format" | "security" | "unknown";

/** Opening a document failed; `reason` says why. */
export class PdfOpenError extends Error {
  /** @param reason Classified PDFium error. */
  constructor(readonly reason: OpenFailure) {
    super(
      reason === "password"
        ? "This PDF needs a password."
        : reason === "format"
          ? "This does not look like a valid PDF file, or it is damaged."
          : reason === "security"
            ? "This PDF uses an encryption method that is not supported."
            : "PDFium could not open this file.",
    );
    this.name = "PdfOpenError";
  }
}

/**
 * Map an `FPDF_GetLastError` code to an {@link OpenFailure}.
 *
 * @param code The error code.
 * @returns The classified reason.
 */
export function classifyOpenError(code: number): OpenFailure {
  switch (code) {
    case FPDF_ERR.PASSWORD:
      return "password";
    case FPDF_ERR.FORMAT:
    case FPDF_ERR.FILE:
      return "format";
    case FPDF_ERR.SECURITY:
      return "security";
    default:
      return "unknown";
  }
}

/** Rendered page pixels: RGBA, 4 bytes per pixel, rows top to bottom. */
export interface RenderedPage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/**
 * An open PDFium document and the WebAssembly memory holding its file.
 *
 * Ownership rules this class enforces:
 * - `FPDF_LoadMemDocument` does not copy the file: PDFium reads from the
 *   given memory for as long as the document is open. The file's block is
 *   therefore kept until {@link close}, and freed only after the document
 *   is closed.
 * - Every page, bitmap and writer opened by a method is closed by that same
 *   method in a `finally` block, so an exception can never leak them.
 */
export class PdfiumDocument {
  private closed = false;

  /**
   * Use {@link PdfiumDocument.open}.
   *
   * @param api The PDFium module.
   * @param heap Memory helper for that module.
   * @param handle The `FPDF_DOCUMENT`.
   * @param dataPtr Address of the file bytes the document reads from, or 0
   *   for a document created empty.
   */
  private constructor(
    private readonly api: PdfiumCoreApi,
    private readonly heap: WasmHeap,
    readonly handle: number,
    private readonly dataPtr: number,
  ) {}

  /**
   * Open a PDF from bytes.
   *
   * @param api The PDFium module.
   * @param heap Memory helper for that module.
   * @param bytes The file.
   * @param password The user password, or "" for none.
   * @returns The open document.
   * @throws {PdfOpenError} When PDFium refuses the file.
   */
  static open(
    api: PdfiumCoreApi,
    heap: WasmHeap,
    bytes: Uint8Array,
    password: string,
  ): PdfiumDocument {
    const dataPtr = heap.copyIn(bytes);
    const handle = api.FPDF_LoadMemDocument(dataPtr, bytes.length, password);
    if (!handle) {
      const code = api.FPDF_GetLastError();
      heap.free(dataPtr);
      throw new PdfOpenError(classifyOpenError(code));
    }
    return new PdfiumDocument(api, heap, handle, dataPtr);
  }

  /**
   * Create a new, empty document (no pages), for example to draw content
   * into and then save.
   *
   * There is no file behind a created document, so the file address is 0,
   * which {@link WasmHeap.free} ignores; {@link close} therefore only
   * closes the document. `FPDF_CreateNewDocument` can only fail when PDFium
   * cannot allocate memory, so a failure is reported as a `RangeError`
   * (classified as "out of memory" by the workers).
   *
   * @param api The PDFium module.
   * @param heap Memory helper for that module.
   * @returns The new document.
   * @throws {RangeError} When PDFium could not create it.
   */
  static create(api: PdfiumCoreApi, heap: WasmHeap): PdfiumDocument {
    const handle = api.FPDF_CreateNewDocument();
    if (!handle)
      throw new RangeError("out of memory: could not create a document");
    return new PdfiumDocument(api, heap, handle, 0);
  }

  /** @returns The number of pages. */
  pageCount(): number {
    return this.api.FPDF_GetPageCount(this.handle);
  }

  /**
   * Load a page, run `fn` with it and close it again, even if `fn` throws.
   *
   * @param index Zero-based page index.
   * @param fn Receives the `FPDF_PAGE` handle.
   * @returns What `fn` returns.
   * @throws When the page cannot be loaded.
   */
  withPage<T>(index: number, fn: (page: number) => T): T {
    const page = this.api.FPDF_LoadPage(this.handle, index);
    if (!page) throw new Error(`Could not load page ${index + 1}`);
    try {
      return fn(page);
    } finally {
      this.api.FPDF_ClosePage(page);
    }
  }

  /**
   * Like {@link withPage}, for work that awaits while the page is open
   * (hashing or encoding between PDFium calls). The page is closed once the
   * returned promise settles, whether it resolves or rejects.
   *
   * The caller must make sure nothing closes the document while `fn` is
   * waiting: PDFium would then free memory the page still points into.
   * Worker handlers guarantee it by running one request at a time.
   *
   * @param index Zero-based page index.
   * @param fn Receives the `FPDF_PAGE` handle.
   * @returns What `fn` resolves to.
   * @throws When the page cannot be loaded.
   */
  async withPageAsync<T>(
    index: number,
    fn: (page: number) => Promise<T>,
  ): Promise<T> {
    const page = this.api.FPDF_LoadPage(this.handle, index);
    if (!page) throw new Error(`Could not load page ${index + 1}`);
    try {
      return await fn(page);
    } finally {
      this.api.FPDF_ClosePage(page);
    }
  }

  /**
   * Insert a new, empty page, run `fn` with it and close it again, even if
   * `fn` throws.
   *
   * The page stays in the document after closing: closing only releases
   * PDFium's loaded copy. Changes `fn` makes to the page's objects must be
   * written into its content with `FPDFPage_GenerateContent` before it is
   * closed, or they are lost.
   *
   * @param index Where to insert the page (0 = first).
   * @param width Page width in points.
   * @param height Page height in points.
   * @param fn Receives the `FPDF_PAGE` handle.
   * @returns What `fn` returns.
   * @throws {RangeError} When PDFium could not create the page.
   */
  withNewPage<T>(
    index: number,
    width: number,
    height: number,
    fn: (page: number) => T,
  ): T {
    const page = this.api.FPDFPage_New(this.handle, index, width, height);
    if (!page) throw new RangeError("out of memory: could not add a page");
    try {
      return fn(page);
    } finally {
      this.api.FPDF_ClosePage(page);
    }
  }

  /**
   * Read a page's visible area and its own rotation.
   *
   * `FPDF_GetPageBoundingBox` writes an `FS_RECTF` (four floats: left, top,
   * right, bottom) in user space. It is the CropBox clipped to the MediaBox,
   * i.e. exactly the area PDFium renders.
   *
   * @param index Zero-based page index.
   * @returns The page's box and /Rotate.
   */
  pageInfo(index: number): PageInfo {
    return this.withPage(index, (page) => {
      const [left, top, right, bottom] = this.heap.using(
        this.heap.alloc(16),
        (rect) => {
          if (!this.api.FPDF_GetPageBoundingBox(page, rect)) {
            throw new Error(`Could not read the size of page ${index + 1}`);
          }
          return this.heap.readFloats(rect, 4);
        },
      );
      const raw = this.api.FPDFPage_GetRotation(page);
      const rotation: QuarterTurns = isQuarterTurns(raw) ? raw : 0;
      return { box: { left, bottom, right, top }, rotation };
    });
  }

  /**
   * Render a page to RGBA pixels on a white background.
   *
   * `FPDF_RenderPageBitmap` already applies the page's own /Rotate; `turns`
   * adds the user's rotation on top. The bitmap is created with an alpha
   * channel and filled with opaque white first, because PDF pages are
   * transparent where nothing is drawn. {@link RENDER_FLAGS} makes PDFium
   * write R, G, B, A in that order, which canvas `ImageData` expects.
   *
   * Each row of a PDFium bitmap may be padded (`stride` bytes long, at least
   * width * 4). The pixels are copied out row by row when there is padding,
   * so the result is always exactly width * height * 4 bytes.
   *
   * `prepare` may change the loaded page before it is drawn, e.g. apply
   * text edits for a preview. Those changes live only in the loaded page:
   * without `FPDFPage_GenerateContent` nothing is written back to the
   * document, and closing the page throws them away, so the next render
   * starts from the original content again.
   *
   * @param index Zero-based page index.
   * @param width Output width in pixels.
   * @param height Output height in pixels.
   * @param turns Clockwise quarter turns to add to the page's rotation.
   * @param prepare Optional changes to make to the loaded page first.
   * @returns The pixels.
   */
  render(
    index: number,
    width: number,
    height: number,
    turns: QuarterTurns,
    prepare?: (page: number) => void,
  ): RenderedPage {
    return this.withPage(index, (page) => {
      prepare?.(page);
      const bitmap = this.api.FPDFBitmap_Create(width, height, 1);
      if (!bitmap)
        throw new RangeError("out of memory: could not create a bitmap");
      try {
        this.api.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
        this.api.FPDF_RenderPageBitmap(
          bitmap,
          page,
          0,
          0,
          width,
          height,
          turns,
          RENDER_FLAGS,
        );
        const buffer = this.api.FPDFBitmap_GetBuffer(bitmap);
        const stride = this.api.FPDFBitmap_GetStride(bitmap);
        const rowBytes = width * 4;
        let pixels: Uint8Array;
        if (stride === rowBytes) {
          pixels = this.heap.copyOut(buffer, rowBytes * height);
        } else {
          pixels = new Uint8Array(rowBytes * height);
          for (let y = 0; y < height; y++) {
            pixels.set(
              this.heap.copyOut(buffer + y * stride, rowBytes),
              y * rowBytes,
            );
          }
        }
        return { width, height, pixels };
      } finally {
        this.api.FPDFBitmap_Destroy(bitmap);
      }
    });
  }

  /**
   * Serialise the document (with every change made so far) to PDF bytes.
   *
   * The EmbedPDF extension collects PDFium's output in a growable buffer
   * ("file writer"): save into it, ask its size, copy that many bytes into a
   * block we own, then copy them out to JavaScript. The writer is closed and
   * the block freed whatever happens. An encrypted document is written
   * encrypted again with its original security handler, so a file that
   * needed a password still needs it.
   *
   * @returns The PDF file's bytes.
   * @throws When PDFium reports a failure.
   */
  save(): Uint8Array {
    const writer = this.api.PDFiumExt_OpenFileWriter();
    if (!writer) throw new RangeError("out of memory: could not start saving");
    try {
      if (!this.api.PDFiumExt_SaveAsCopy(this.handle, writer)) {
        throw new Error("PDFium could not save the document");
      }
      const size = this.api.PDFiumExt_GetFileWriterSize(writer);
      return this.heap.using(this.heap.alloc(size), (ptr) => {
        this.api.PDFiumExt_GetFileWriterData(writer, ptr, size);
        return this.heap.copyOut(ptr, size);
      });
    } finally {
      this.api.PDFiumExt_CloseFileWriter(writer);
    }
  }

  /**
   * Close the document, then free its file bytes (in that order: PDFium may
   * read the bytes until the document is closed). Safe to call twice.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.api.FPDF_CloseDocument(this.handle);
    this.heap.free(this.dataPtr);
  }
}
