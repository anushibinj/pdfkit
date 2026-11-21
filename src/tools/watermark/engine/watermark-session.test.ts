import { describe, expect, it, vi } from "vitest";
import { FPDF_ERR } from "@/lib/pdfium/core-api";
import { QpdfJob, type QpdfEngine } from "@/lib/qpdf/qpdf-runner";
import { DEFAULT_SETTINGS } from "../core/model";
import { InvalidSettingsError } from "../core/sanitize-settings";
import { fakeWatermarkPdfium } from "../test-utils/fake-pdfium";
import { createPainterRegistry } from "./painters/registry";
import { SOURCE_PATH } from "./qpdf-stamper";
import { WatermarkSession } from "./watermark-session";

/** A qpdf engine whose every run "succeeds" by writing a 2-byte output. */
function fakeQpdf() {
  const files = new Map<string, Uint8Array>();
  const run = vi.fn((args: readonly string[]) => {
    files.set(args[args.length - 1], new Uint8Array([37, 80]));
    return { code: 0, stdout: "", stderr: "" };
  });
  const engine: QpdfEngine = {
    run,
    writeFile: (path, bytes) => void files.set(path, bytes),
    readFile: (path) => files.get(path)!,
    exists: (path) => files.has(path),
    remove: (path) => void files.delete(path),
    withJob: (fn) => fn(new QpdfJob("/job-1")),
  };
  return { engine, files, run };
}

function setup(pageCount = 2) {
  const { api, runtime } = fakeWatermarkPdfium();
  api.FPDF_GetPageCount.mockReturnValue(pageCount);
  api.FPDF_GetPageBoundingBox.mockImplementation((_page, rect) => {
    [0, 792, 612, 0].forEach((v, i) => runtime.setValue(rect + i * 4, v));
    return true;
  });
  // text measuring: every line's ink is 100 x 50
  api.FPDFPageObj_GetBounds.mockImplementation((_o, l, b, r, t) => {
    [0, 0, 100, 50].forEach((v, i) => runtime.setValue([l, b, r, t][i], v));
    return true;
  });
  const qpdf = fakeQpdf();
  const session = new WatermarkSession(
    api,
    qpdf.engine,
    createPainterRegistry(),
  );
  return { api, runtime, qpdf, session };
}

describe("WatermarkSession", () => {
  it("open reads every page, frees PDFium's copy and keeps the file in qpdf", () => {
    const { api, runtime, qpdf, session } = setup(3);
    expect(session.open(new Uint8Array([1, 2]), "pw")).toBe(3);
    expect(api.FPDF_LoadMemDocument).toHaveBeenCalledWith(
      expect.any(Number),
      2,
      "pw",
    );
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(runtime.leaks()).toEqual([]);
    expect(qpdf.files.get(SOURCE_PATH)).toEqual(new Uint8Array([1, 2]));
    expect(session.isOpen()).toBe(true);
  });

  it("open refuses a PDF without pages and still closes it", () => {
    const { api, session } = setup(0);
    expect(() => session.open(new Uint8Array(1), "")).toThrow("no pages");
    expect(api.FPDF_CloseDocument).toHaveBeenCalledTimes(1);
    expect(session.isOpen()).toBe(false);
  });

  it("open reports a wrong password and keeps nothing", () => {
    const { api, qpdf, session } = setup();
    api.FPDF_LoadMemDocument.mockReturnValue(0);
    api.FPDF_GetLastError.mockReturnValue(FPDF_ERR.PASSWORD);
    expect(() => session.open(new Uint8Array(1), "x")).toThrow(
      expect.objectContaining({ reason: "password" }),
    );
    expect(qpdf.files.size).toBe(0);
  });

  it("apply validates, stamps and returns qpdf's output", () => {
    const { qpdf, session } = setup(3);
    session.open(new Uint8Array(1), "");
    const out = session.apply(DEFAULT_SETTINGS, [2, 0]);
    expect(Array.from(out)).toEqual([37, 80]);
    // all pages are Letter: one stamp page, pages 1 and 3
    expect(qpdf.run).toHaveBeenLastCalledWith(
      expect.arrayContaining(["--overlay", "--to=1,3", "--from=1,1"]),
    );
  });

  it("apply refuses invalid settings and pages", () => {
    const { session } = setup();
    session.open(new Uint8Array(1), "");
    expect(() =>
      session.apply(
        { ...DEFAULT_SETTINGS, content: { kind: "text", text: "" } },
        [0],
      ),
    ).toThrow(InvalidSettingsError);
    expect(() => session.apply(DEFAULT_SETTINGS, [5])).toThrow(
      InvalidSettingsError,
    );
  });

  it("preview renders qpdf's one-page output and frees it", () => {
    const { api, runtime, qpdf, session } = setup();
    session.open(new Uint8Array(1), "");
    api.FPDFBitmap_GetStride.mockReturnValue(4 * 306);
    const page = session.preview(1, 306, DEFAULT_SETTINGS);
    expect([page.width, page.height]).toEqual([306, 396]);
    expect(qpdf.run).toHaveBeenLastCalledWith(
      expect.arrayContaining(["--pages", ".", "2", "--overlay"]),
    );
    expect(runtime.leaks()).toEqual([]);
    session.preview(0, 306);
    expect(qpdf.run).toHaveBeenLastCalledWith(
      expect.not.arrayContaining(["--overlay"]),
    );
  });

  it("preview refuses pages that do not exist", () => {
    const { session } = setup(2);
    session.open(new Uint8Array(1), "");
    expect(() => session.preview(2, 100)).toThrow("There is no page 3.");
    expect(() => session.preview(0.5, 100)).toThrow("There is no page");
  });

  it("refuses work without an open file and close frees qpdf's copy", () => {
    const { qpdf, session } = setup();
    expect(() => session.apply(DEFAULT_SETTINGS, [0])).toThrow(
      "No PDF is open.",
    );
    expect(() => session.preview(0, 10)).toThrow("No PDF is open.");
    session.open(new Uint8Array(1), "");
    session.close();
    session.close();
    expect(qpdf.files.has(SOURCE_PATH)).toBe(false);
    expect(session.isOpen()).toBe(false);
  });
});
