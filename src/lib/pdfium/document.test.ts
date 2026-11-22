import { describe, expect, it } from "vitest";
import {
  FPDF_ERR,
  PdfOpenError,
  PdfiumDocument,
  RENDER_FLAGS,
  classifyOpenError,
} from "./document";
import { fakeDocumentPdfium } from "./test-utils/fake-api";
import { WasmHeap } from "./wasm-heap";

function setup() {
  const { api, runtime } = fakeDocumentPdfium();
  const heap = new WasmHeap(runtime);
  return { api, runtime, heap };
}

describe("classifyOpenError", () => {
  it.each([
    [FPDF_ERR.PASSWORD, "password"],
    [FPDF_ERR.FORMAT, "format"],
    [FPDF_ERR.FILE, "format"],
    [FPDF_ERR.SECURITY, "security"],
    [FPDF_ERR.UNKNOWN, "unknown"],
    [99, "unknown"],
  ] as const)("%d -> %s", (code, reason) => {
    expect(classifyOpenError(code)).toBe(reason);
  });
});

describe("PdfOpenError", () => {
  it("carries the reason and a readable message", () => {
    const err = new PdfOpenError("format");
    expect(err.reason).toBe("format");
    expect(err.message).toMatch(/valid PDF/);
    expect(err.name).toBe("PdfOpenError");
  });
});

describe("PdfiumDocument", () => {
  it("open passes the file and password, close frees in the right order", () => {
    const { api, runtime, heap } = setup();
    api.FPDF_CloseDocument.mockImplementation(() => runtime.log.push("close"));
    const doc = PdfiumDocument.open(api, heap, new Uint8Array([1, 2, 3]), "pw");
    const [dataPtr] = runtime.allocated;
    expect(api.FPDF_LoadMemDocument).toHaveBeenCalledWith(dataPtr, 3, "pw");
    // the file must stay allocated while the document is open
    expect(runtime.leaks()).toEqual([dataPtr]);
    doc.close();
    doc.close();
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    // PDFium may read the bytes until the document is closed
    expect(runtime.log.slice(-2)).toEqual(["close", `free:${dataPtr}`]);
    expect(runtime.leaks()).toEqual([]);
  });

  it("open frees the file and throws a classified error on failure", () => {
    const { api, runtime, heap } = setup();
    api.FPDF_LoadMemDocument.mockReturnValue(0);
    api.FPDF_GetLastError.mockReturnValue(FPDF_ERR.PASSWORD);
    expect(() => PdfiumDocument.open(api, heap, new Uint8Array(4), "")).toThrow(
      expect.objectContaining({ reason: "password" }),
    );
    expect(runtime.leaks()).toEqual([]);
  });

  it("pageCount asks PDFium", () => {
    const { api, heap } = setup();
    api.FPDF_GetPageCount.mockReturnValue(7);
    expect(
      PdfiumDocument.open(api, heap, new Uint8Array(1), "").pageCount(),
    ).toBe(7);
  });

  it("withPage closes the page even when the callback throws", () => {
    const { api, heap } = setup();
    const doc = PdfiumDocument.open(api, heap, new Uint8Array(1), "");
    expect(() =>
      doc.withPage(0, () => {
        throw new Error("x");
      }),
    ).toThrow("x");
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(1);
    api.FPDF_LoadPage.mockReturnValueOnce(0);
    expect(() => doc.withPage(3, () => 1)).toThrow("Could not load page 4");
  });

  it("withPageAsync keeps the page open until the work settles", async () => {
    const { api, heap } = setup();
    const doc = PdfiumDocument.open(api, heap, new Uint8Array(1), "");
    api.FPDF_LoadPage.mockReturnValue(55);
    let release: () => void = () => {};
    const pending = doc.withPageAsync(0, async (page) => {
      await new Promise<void>((resolve) => (release = resolve));
      return page;
    });
    await Promise.resolve();
    expect(api.FPDF_ClosePage).not.toHaveBeenCalled();
    release();
    await expect(pending).resolves.toBe(55);
    expect(api.FPDF_ClosePage).toHaveBeenCalledWith(55);
    // a rejection still closes the page
    await expect(
      doc.withPageAsync(0, async () => {
        throw new Error("late");
      }),
    ).rejects.toThrow("late");
    expect(api.FPDF_ClosePage).toHaveBeenCalledTimes(2);
    api.FPDF_LoadPage.mockReturnValueOnce(0);
    await expect(doc.withPageAsync(1, async () => 1)).rejects.toThrow(
      "Could not load page 2",
    );
  });

  it("pageInfo reads the bounding box floats and the rotation", () => {
    const { api, runtime, heap } = setup();
    api.FPDF_GetPageBoundingBox.mockImplementation((_page, rect) => {
      [10, 800, 600, 20].forEach((v, i) => runtime.setValue(rect + i * 4, v));
      return true;
    });
    api.FPDFPage_GetRotation.mockReturnValue(3);
    const doc = PdfiumDocument.open(api, heap, new Uint8Array(1), "");
    expect(doc.pageInfo(0)).toEqual({
      box: { left: 10, bottom: 20, right: 600, top: 800 },
      rotation: 3,
    });
    api.FPDFPage_GetRotation.mockReturnValue(9);
    expect(doc.pageInfo(0).rotation).toBe(0);
    api.FPDF_GetPageBoundingBox.mockReturnValue(false);
    expect(() => doc.pageInfo(0)).toThrow("Could not read the size of page 1");
    doc.close();
    expect(runtime.leaks()).toEqual([]);
  });

  it("render fills white, renders RGBA with the user turns and strips row padding", () => {
    const { api, runtime, heap } = setup();
    const doc = PdfiumDocument.open(api, heap, new Uint8Array(1), "");
    // a 2x2 bitmap whose rows are padded to 12 bytes
    const buffer = heap.copyIn(
      new Uint8Array([
        1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0, 3, 3, 3, 3, 4, 4, 4, 4, 0, 0, 0, 0,
      ]),
    );
    api.FPDFBitmap_GetBuffer.mockReturnValue(buffer);
    api.FPDFBitmap_GetStride.mockReturnValue(12);
    const out = doc.render(0, 2, 2, 1);
    expect(api.FPDFBitmap_FillRect).toHaveBeenCalledWith(
      expect.any(Number),
      0,
      0,
      2,
      2,
      0xffffffff,
    );
    expect(api.FPDF_RenderPageBitmap).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      0,
      0,
      2,
      2,
      1,
      RENDER_FLAGS,
    );
    expect(Array.from(out.pixels)).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4,
    ]);
    expect(api.FPDFBitmap_Destroy).toHaveBeenCalled();
    heap.free(buffer);
    doc.close();
    expect(runtime.leaks()).toEqual([]);
  });

  it("render copies unpadded bitmaps in one go and fails cleanly without memory", () => {
    const { api, heap } = setup();
    const doc = PdfiumDocument.open(api, heap, new Uint8Array(1), "");
    const buffer = heap.copyIn(new Uint8Array([5, 5, 5, 5]));
    api.FPDFBitmap_GetBuffer.mockReturnValue(buffer);
    api.FPDFBitmap_GetStride.mockReturnValue(4);
    expect(Array.from(doc.render(0, 1, 1, 0).pixels)).toEqual([5, 5, 5, 5]);
    api.FPDFBitmap_Create.mockReturnValue(0);
    expect(() => doc.render(0, 1, 1, 0)).toThrow(RangeError);
  });

  it("render lets prepare change the loaded page before drawing it", () => {
    const { api, heap } = setup();
    const doc = PdfiumDocument.open(api, heap, new Uint8Array(1), "");
    api.FPDFBitmap_GetStride.mockReturnValue(4);
    const order: string[] = [];
    api.FPDF_LoadPage.mockReturnValue(77);
    api.FPDF_RenderPageBitmap.mockImplementation(() => {
      order.push("draw");
    });
    api.FPDF_ClosePage.mockImplementation(() => {
      order.push("close");
    });
    doc.render(0, 1, 1, 0, (page) => order.push(`prepare ${page}`));
    expect(order).toEqual(["prepare 77", "draw", "close"]);
    // a failing prepare still closes the page and creates no bitmap
    expect(() =>
      doc.render(0, 1, 1, 0, () => {
        throw new Error("bad edit");
      }),
    ).toThrow("bad edit");
    expect(order.at(-1)).toBe("close");
    expect(api.FPDFBitmap_Create).toHaveBeenCalledTimes(1);
  });
});
