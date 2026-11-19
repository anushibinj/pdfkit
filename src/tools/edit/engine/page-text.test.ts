import { describe, expect, it } from "vitest";
import { fakePdfium, type MockedPdfium } from "../test-utils/fake-pdfium";
import { PdfiumPageText } from "./page-text";
import { PAGE_OBJECT_TEXT } from "./pdfium-api";
import { WasmHeap } from "./wasm-heap";

const DOC = 1;
const PAGE = 2;
const TEXT_PAGE = 3;
const FONT = 40;
const TEXT_OBJ = 50;
const PATH_OBJ = 51;
const HIDDEN_OBJ = 52;

/**
 * A fake page with three objects: a text object "Hi there" in a subset
 * font, a path, and invisible (OCR-style) text. PDFium "writes" results
 * through the pointers it is given, as the real one does.
 */
function setup() {
  const { api, runtime } = fakePdfium();
  const heap = new WasmHeap(runtime);
  let objects = [TEXT_OBJ, PATH_OBJ, HIDDEN_OBJ];
  api.FPDFText_LoadPage.mockReturnValue(TEXT_PAGE);
  api.FPDFPage_CountObjects.mockImplementation(() => objects.length);
  api.FPDFPage_GetObject.mockImplementation((_p, i) => objects[i] ?? 0);
  api.FPDFPage_RemoveObject.mockImplementation((_p, o) => {
    objects = objects.filter((x) => x !== o);
    return true;
  });
  api.FPDFPage_InsertObjectAtIndex.mockImplementation((_p, o, i) => {
    objects.splice(i, 0, o);
    return true;
  });
  api.FPDFPageObj_GetType.mockImplementation((o) =>
    o === PATH_OBJ ? 2 : PAGE_OBJECT_TEXT,
  );
  api.FPDFTextObj_GetTextRenderMode.mockImplementation((o) =>
    o === HIDDEN_OBJ ? 3 : 0,
  );
  api.FPDFTextObj_GetFont.mockReturnValue(FONT);
  const writeText = (text: string) => (buf: number, len: number) => {
    if (buf) runtime.writeUtf16(buf, text);
    return len === 0 ? (text.length + 1) * 2 : len;
  };
  api.FPDFTextObj_GetText.mockImplementation((_o, _tp, buf, len) =>
    writeText("Hi there")(buf, len),
  );
  const writeUtf8 = (text: string) => (_f: number, buf: number) => {
    const bytes = new TextEncoder().encode(`${text}\0`);
    if (buf) runtime.HEAPU8.set(bytes, buf);
    return bytes.length;
  };
  api.FPDFFont_GetBaseFontName.mockImplementation(
    writeUtf8("ABCDEF+Sans-Bold"),
  );
  api.FPDFFont_GetFamilyName.mockImplementation(writeUtf8("Sans"));
  api.FPDFFont_GetIsEmbedded.mockReturnValue(1);
  api.FPDFFont_GetWeight.mockReturnValue(700);
  api.FPDFTextObj_GetFontSize.mockImplementation((_o, ptr) => {
    runtime.setValue(ptr, 12);
    return true;
  });
  api.FPDFPageObj_GetMatrix.mockImplementation((_o, ptr) => {
    [2, 0, 0, 2, 50, 700].forEach((v, i) => runtime.setValue(ptr + i * 4, v));
    return true;
  });
  api.FPDFPageObj_GetBounds.mockImplementation((_o, l, b, r, t) => {
    runtime.setValue(l, 50);
    runtime.setValue(b, 698);
    runtime.setValue(r, 140);
    runtime.setValue(t, 720);
    return true;
  });
  api.FPDFPageObj_GetFillColor.mockImplementation((_o, r, g, b, a) => {
    runtime.setValue(r, 10);
    runtime.setValue(g, 20);
    runtime.setValue(b, 30);
    runtime.setValue(a, 128);
    return true;
  });
  // characters: H i (generated space) t
  const chars = [
    { code: 72, generated: 0, x: 50 },
    { code: 105, generated: 0, x: 60 },
    { code: 32, generated: 1, x: 70 },
    { code: 116, generated: 0, x: 75 },
  ];
  api.FPDFText_CountChars.mockReturnValue(chars.length);
  api.FPDFText_GetUnicode.mockImplementation((_tp, i) => chars[i].code);
  api.FPDFText_IsGenerated.mockImplementation((_tp, i) => chars[i].generated);
  api.FPDFText_GetTextObject.mockReturnValue(TEXT_OBJ);
  api.FPDFText_GetCharOrigin.mockImplementation((_tp, i, x, y) => {
    runtime.setValue(x, chars[i].x);
    runtime.setValue(y, 700);
    return true;
  });
  const text = new PdfiumPageText(api, heap, DOC, PAGE);
  return { api, runtime, text, objects: () => objects };
}

/** The handle of the object `NewTextObj` created (mock's first result). */
const created = (api: MockedPdfium) =>
  api.FPDFPageObj_NewTextObj.mock.results[0].value as number;

describe("PdfiumPageText.read (readFragment, readChars, describeFont, objectText)", () => {
  it("reads visible text objects with their font, size, place and colour", () => {
    const { api, runtime, text } = setup();
    const { fragments, observed } = text.read();
    expect(fragments).toEqual([
      {
        index: 0,
        text: "Hi there",
        fontKey: FONT,
        font: {
          baseName: "ABCDEF+Sans-Bold",
          family: "Sans",
          flags: 0,
          weight: 700,
          italicAngle: 0,
          embedded: true,
        },
        fontSize: 12,
        matrix: [2, 0, 0, 2, 50, 700],
        bounds: { left: 50, bottom: 698, right: 140, top: 720 },
        color: { r: 10, g: 20, b: 30 },
        renderMode: 0,
      },
    ]);
    // the path and the invisible text are not editable fragments
    expect(observed.get(FONT)).toEqual(new Set(["H", "i", "t"]));
    expect(api.FPDFText_ClosePage).toHaveBeenCalledWith(TEXT_PAGE);
    expect(runtime.leaks()).toEqual([]);
  });

  it("reads once and returns the same snapshot afterwards", () => {
    const { api, text } = setup();
    expect(text.read()).toBe(text.read());
    expect(api.FPDFText_LoadPage).toHaveBeenCalledTimes(1);
  });

  it("uses the stroke colour for outline-only text", () => {
    const { api, runtime, text } = setup();
    api.FPDFTextObj_GetTextRenderMode.mockReturnValue(1);
    api.FPDFPageObj_GetStrokeColor.mockImplementation((_o, r, g, b) => {
      runtime.setValue(r, 200);
      runtime.setValue(g, 0);
      runtime.setValue(b, 0);
      return true;
    });
    expect(text.read().fragments[0].color).toEqual({ r: 200, g: 0, b: 0 });
  });

  it("skips text it cannot measure and closes the text page on errors", () => {
    const { api, text } = setup();
    api.FPDFTextObj_GetFontSize.mockReturnValue(false);
    expect(text.read().fragments).toEqual([]);
    const { api: api2, text: text2 } = setup();
    api2.FPDFPage_CountObjects.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => text2.read()).toThrow("boom");
    expect(api2.FPDFText_ClosePage).toHaveBeenCalled();
    expect(api.FPDFText_ClosePage).toHaveBeenCalled();
  });

  it("readChars skips characters it cannot attribute or encode", () => {
    const { api, text } = setup();
    const codes = [0x48, 0xd800, 0x110000, 0x69, 0];
    api.FPDFText_CountChars.mockReturnValue(codes.length);
    api.FPDFText_GetUnicode.mockImplementation((_tp, i) => codes[i]);
    api.FPDFText_IsGenerated.mockReturnValue(0);
    // the 4th character has no text object behind it
    api.FPDFText_GetTextObject.mockImplementation((_tp, i) =>
      i === 3 ? 0 : TEXT_OBJ,
    );
    expect(text.read().observed.get(FONT)).toEqual(new Set(["H"]));
  });

  it("describeFont reads the italic angle and is asked once per font", () => {
    const { api, runtime, text } = setup();
    api.FPDFFont_GetItalicAngle.mockImplementation((_f, ptr) => {
      runtime.setValue(ptr, -12);
      return true;
    });
    let n = 0;
    api.FPDFPage_CountObjects.mockReturnValue(2);
    api.FPDFPage_GetObject.mockImplementation(() => 60 + n++);
    api.FPDFPageObj_GetType.mockReturnValue(PAGE_OBJECT_TEXT);
    api.FPDFTextObj_GetTextRenderMode.mockReturnValue(0);
    const { fragments } = text.read();
    expect(fragments).toHaveLength(2);
    expect(fragments[0].font.italicAngle).toBe(-12);
    expect(api.FPDFFont_GetFlags).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when PDFium cannot build the text page", () => {
    const { api, text } = setup();
    api.FPDFText_LoadPage.mockReturnValue(0);
    expect(() => text.read()).toThrow("Could not read the text");
  });
});

describe("PdfiumPageText changes (setText, remove, replace, copyPaint, currentPosition, fragment, probe)", () => {
  it("setText encodes the text for the object and frees the buffer", () => {
    const { api, runtime, text } = setup();
    text.read();
    text.setText(0, "Hit");
    const [obj, ptr] = api.FPDFText_SetText.mock.calls[0];
    expect(obj).toBe(TEXT_OBJ);
    expect(runtime.strings.get(ptr)).toBe("Hit");
    expect(runtime.leaks()).toEqual([]);
    expect(() => text.setText(9, "x")).toThrow("no text object 9");
  });

  it("remove takes the object off the page and destroys it", () => {
    const { api, text, objects } = setup();
    text.read();
    text.remove(0);
    expect(objects()).not.toContain(TEXT_OBJ);
    expect(api.FPDFPageObj_Destroy).toHaveBeenCalledWith(TEXT_OBJ);
    expect(() => text.remove(0)).toThrow("no text object 0");
  });

  it("replace puts a styled copy at the original's place in the order", () => {
    const { api, runtime, text, objects } = setup();
    text.read();
    text.replace(0, "Helvetica-Bold", "Hello");
    const obj = created(api);
    expect(api.FPDFPageObj_NewTextObj).toHaveBeenCalledWith(
      DOC,
      "Helvetica-Bold",
      12,
    );
    // the same matrix buffer is read from the original and set on the copy
    const matrixPtr = api.FPDFPageObj_GetMatrix.mock.lastCall![1];
    expect(api.FPDFPageObj_SetMatrix).toHaveBeenCalledWith(obj, matrixPtr);
    expect(api.FPDFPageObj_SetFillColor).toHaveBeenCalledWith(
      obj,
      10,
      20,
      30,
      128,
    );
    expect(api.FPDFTextObj_SetTextRenderMode).toHaveBeenCalledWith(obj, 0);
    expect(objects()).toEqual([obj, PATH_OBJ, HIDDEN_OBJ]);
    // the original was freed, the new object never (the page owns it)
    expect(api.FPDFPageObj_Destroy.mock.calls).toEqual([[TEXT_OBJ]]);
    // the index now refers to the new object
    text.remove(0);
    expect(objects()).toEqual([PATH_OBJ, HIDDEN_OBJ]);
    expect(runtime.leaks()).toEqual([]);
  });

  it("copyPaint copies stroke colour and width for outlined text", () => {
    const { api, runtime, text } = setup();
    api.FPDFTextObj_GetTextRenderMode.mockReturnValue(2); // fill + stroke
    api.FPDFPageObj_GetStrokeColor.mockImplementation((_o, r, g, b, a) => {
      [r, g, b, a].forEach((p, i) => runtime.setValue(p, [1, 2, 3, 255][i]));
      return true;
    });
    api.FPDFPageObj_GetStrokeWidth.mockImplementation((_o, ptr) => {
      runtime.setValue(ptr, 0.5);
      return true;
    });
    text.read();
    text.replace(0, "Helvetica", "x");
    const obj = created(api);
    expect(api.FPDFPageObj_SetStrokeColor).toHaveBeenCalledWith(
      obj,
      1,
      2,
      3,
      255,
    );
    expect(api.FPDFPageObj_SetStrokeWidth).toHaveBeenCalledWith(obj, 0.5);
    expect(api.FPDFTextObj_SetTextRenderMode).toHaveBeenCalledWith(obj, 2);
  });

  it("replace frees the new object when it cannot be inserted", () => {
    const { api, runtime, text, objects } = setup();
    text.read();
    api.FPDFPage_InsertObjectAtIndex.mockReturnValue(false);
    expect(() => text.replace(0, "Helvetica", "x")).toThrow(
      "add the text to the page",
    );
    expect(api.FPDFPageObj_Destroy.mock.calls).toEqual([[created(api)]]);
    expect(objects()).toContain(TEXT_OBJ); // the original is untouched
    expect(runtime.leaks()).toEqual([]);
  });

  it("replace fails cleanly when PDFium cannot create the object", () => {
    const { api, text } = setup();
    text.read();
    api.FPDFPageObj_NewTextObj.mockReturnValue(0);
    expect(() => text.replace(0, "Helvetica", "x")).toThrow(
      "could not create a text object",
    );
    expect(api.FPDFPageObj_Destroy).not.toHaveBeenCalled();
  });

  it("replace needs a fragment that was read and still on the page", () => {
    const { api, text } = setup();
    expect(() => text.replace(0, "Helvetica", "x")).toThrow();
    text.read();
    api.FPDFPage_GetObject.mockReturnValue(0); // the object vanished
    expect(() => text.replace(0, "Helvetica", "x")).toThrow(
      "no longer on the page",
    );
  });

  it("probe writes each text in the fragment's font, off the page, and reads it back", () => {
    const { api, runtime, text, objects } = setup();
    text.read();
    const probes: number[] = [];
    api.FPDFPageObj_CreateTextObj.mockImplementation(() => {
      probes.push(900 + probes.length);
      return probes[probes.length - 1];
    });
    api.FPDFPage_InsertObject.mockImplementation((_p, o) => {
      objects().push(o);
    });
    api.FPDFText_LoadPage.mockReturnValue(33);
    api.FPDFTextObj_GetText.mockImplementation((o, _tp, buf) => {
      const value = o === 900 ? "Hit" : "Hat";
      if (buf) runtime.writeUtf16(buf, value);
      return (value.length + 1) * 2;
    });
    const out = text.probe([
      { index: 0, text: "Hit" },
      { index: 0, text: "Hat" },
    ]);
    expect(out).toEqual(new Map([[0, "Hat"]])); // same index: last wins
    // created in the fragment's own font and size
    expect(api.FPDFPageObj_CreateTextObj).toHaveBeenCalledWith(DOC, FONT, 12);
    // same orientation and scale as the line, far outside the page, and
    // the second probe further out than the first
    const [, m1] = api.FPDFPageObj_SetMatrix.mock.calls[0];
    const [, m2] = api.FPDFPageObj_SetMatrix.mock.calls[1];
    const values = (ptr: number) =>
      [0, 1, 2, 3, 4, 5].map((i) => runtime.getValue(ptr + i * 4));
    expect(values(m1)).toEqual([2, 0, 0, 2, -100_000, -100_000]);
    expect(values(m2)[4]).toBeLessThan(-100_000 - 1_000);
    // both removed and freed again; the page is as it was
    expect(objects()).toEqual([TEXT_OBJ, PATH_OBJ, HIDDEN_OBJ]);
    expect(api.FPDFPageObj_Destroy.mock.calls).toEqual([[900], [901]]);
    expect(api.FPDFText_ClosePage).toHaveBeenLastCalledWith(33);
    expect(runtime.leaks()).toEqual([]);
  });

  it("probe cleans up when reading back fails", () => {
    const { api, text, objects } = setup();
    text.read();
    api.FPDFPageObj_CreateTextObj.mockReturnValue(900);
    api.FPDFPage_InsertObject.mockImplementation((_p, o) => {
      objects().push(o);
    });
    api.FPDFText_LoadPage.mockReturnValue(0);
    expect(() => text.probe([{ index: 0, text: "x" }])).toThrow(
      "Could not read the text",
    );
    expect(objects()).not.toContain(900);
    expect(api.FPDFPageObj_Destroy).toHaveBeenCalledWith(900);
  });

  it("probe frees an object it could not set up, and never inserts it", () => {
    const { api, runtime, text } = setup();
    text.read();
    api.FPDFPageObj_CreateTextObj.mockReturnValue(900);
    api.FPDFText_SetText.mockReturnValue(false);
    expect(() => text.probe([{ index: 0, text: "x" }])).toThrow(
      "write the text",
    );
    expect(api.FPDFPage_InsertObject).not.toHaveBeenCalled();
    expect(api.FPDFPageObj_Destroy.mock.calls).toEqual([[900]]);
    expect(runtime.leaks()).toEqual([]);
    api.FPDFPageObj_CreateTextObj.mockReturnValue(0);
    expect(() => text.probe([{ index: 0, text: "x" }])).toThrow(
      "could not create a text object",
    );
  });

  it("probe does not free a probe the page refused to give back", () => {
    const { api, text } = setup();
    text.read();
    api.FPDFPageObj_CreateTextObj.mockReturnValue(900);
    api.FPDFPage_RemoveObject.mockReturnValue(false);
    expect(() => text.probe([{ index: 0, text: "x" }])).toThrow(
      "remove a probe",
    );
    expect(api.FPDFPageObj_Destroy).not.toHaveBeenCalled();
  });
});
