import { describe, expect, it, vi } from "vitest";
import {
  imageFindings,
  pageFile,
  runConversion,
  type ConversionEngine,
  type RunHandlers,
} from "./conversion-runner";
import type { RenderPageResult, WireImageEntry } from "./messages";

const options = { format: "png" as const, dpi: 150, quality: 0.9 };

const rendered = (pageIndex: number): RenderPageResult => ({
  status: "page",
  pageIndex,
  width: 10,
  height: 20,
  dpi: 150,
  reduced: false,
  mimeType: "image/png",
  data: new Uint8Array([1, 2]).buffer,
});

const image = (key: string): WireImageEntry => ({
  kind: "image",
  key,
  width: 3,
  height: 4,
  mimeType: "image/jpeg",
  method: "original-jpeg",
  data: new Uint8Array([9]).buffer,
});

/** Recording handlers that ask to stop after `stopAfter` pages. */
function handlers(stopAfter = Infinity) {
  let asked = 0;
  return {
    onPage: vi.fn<RunHandlers["onPage"]>(),
    onImages: vi.fn<RunHandlers["onImages"]>(),
    shouldStop: () => asked++ >= stopAfter,
  } satisfies RunHandlers;
}

describe("pageFile", () => {
  it("wraps the page's bytes in a typed Blob with 1-based page number", async () => {
    const file = pageFile(
      rendered(2) as Extract<RenderPageResult, { status: "page" }>,
    );
    expect(file).toMatchObject({
      id: "page-2",
      mimeType: "image/png",
      width: 10,
      height: 20,
      pages: [3],
      dpi: 150,
      reduced: false,
    });
    expect(file.blob.type).toBe("image/png");
    expect(file.blob.size).toBe(2);
  });
});

describe("imageFindings", () => {
  it("sorts entries into files, repeats and skipped images", () => {
    const findings = imageFindings(0, [
      image("a"),
      { kind: "repeat", key: "b" },
      { kind: "skipped", key: "c", width: 5, height: 6, reason: "too large" },
    ]);
    expect(findings.page).toBe(1);
    expect(findings.files).toHaveLength(1);
    expect(findings.files[0]).toMatchObject({
      id: "a",
      mimeType: "image/jpeg",
      pages: [1],
      method: "original-jpeg",
    });
    expect(findings.files[0].blob.type).toBe("image/jpeg");
    expect(findings.repeats).toEqual(["b"]);
    expect(findings.skipped).toEqual([
      { key: "c", page: 1, width: 5, height: 6, reason: "too large" },
    ]);
  });
});

describe("runConversion", () => {
  it("renders the selected pages in order", async () => {
    const engine: ConversionEngine = {
      renderPage: vi.fn(async (i) => rendered(i)),
      extractImages: vi.fn(),
    };
    const h = handlers();
    expect(await runConversion(engine, "pages", [0, 2], options, h)).toEqual({
      ok: true,
      stopped: false,
    });
    expect(engine.renderPage).toHaveBeenNthCalledWith(1, 0, options);
    expect(engine.renderPage).toHaveBeenNthCalledWith(2, 2, options);
    expect(h.onPage.mock.calls.map(([f]) => f.id)).toEqual([
      "page-0",
      "page-2",
    ]);
    expect(engine.extractImages).not.toHaveBeenCalled();
  });

  it("sends the keys of images met on earlier pages, skipped ones included", async () => {
    const answers = [
      [
        image("a"),
        { kind: "skipped", key: "s", width: 1, height: 1, reason: "x" },
      ],
      [{ kind: "repeat", key: "a" }, image("b")],
      [],
    ] as WireImageEntry[][];
    const engine: ConversionEngine = {
      renderPage: vi.fn(),
      extractImages: vi.fn(async (pageIndex) => ({
        status: "images" as const,
        pageIndex,
        entries: answers[pageIndex],
      })),
    };
    const h = handlers();
    await runConversion(engine, "images", [0, 1, 2], options, h);
    expect(engine.extractImages).toHaveBeenNthCalledWith(1, 0, []);
    expect(engine.extractImages).toHaveBeenNthCalledWith(2, 1, ["a", "s"]);
    expect(engine.extractImages).toHaveBeenNthCalledWith(3, 2, ["a", "s", "b"]);
    expect(h.onImages).toHaveBeenCalledTimes(3);
    expect(h.onImages.mock.calls[1][0].repeats).toEqual(["a"]);
  });

  it("stops before the next page when asked", async () => {
    const engine: ConversionEngine = {
      renderPage: vi.fn(async (i) => rendered(i)),
      extractImages: vi.fn(),
    };
    const h = handlers(1);
    expect(await runConversion(engine, "pages", [0, 1, 2], options, h)).toEqual(
      { ok: true, stopped: true },
    );
    expect(engine.renderPage).toHaveBeenCalledTimes(1);
  });

  it("is not stopped when no page is left to skip", async () => {
    const engine: ConversionEngine = {
      renderPage: vi.fn(async (i) => rendered(i)),
      extractImages: vi.fn(),
    };
    // Asked before each of the two pages; the stop comes too late to skip
    // any (as when Stop is pressed while the last page is rendering).
    expect(
      await runConversion(engine, "pages", [0, 1], options, handlers(2)),
    ).toEqual({ ok: true, stopped: false });
    expect(engine.renderPage).toHaveBeenCalledTimes(2);
  });

  it("ends at the first failure, naming the page", async () => {
    const engine: ConversionEngine = {
      renderPage: vi.fn(async (i) =>
        i === 1
          ? {
              status: "error" as const,
              reason: "out-of-memory" as const,
              message: "Out of memory.",
            }
          : rendered(i),
      ),
      extractImages: vi.fn(async () => ({
        status: "error" as const,
        reason: "failed" as const,
        message: "Broken.",
      })),
    };
    const h = handlers();
    expect(await runConversion(engine, "pages", [0, 1, 2], options, h)).toEqual(
      {
        ok: false,
        message: "Page 2: Out of memory.",
      },
    );
    expect(h.onPage).toHaveBeenCalledTimes(1);
    expect(await runConversion(engine, "images", [4], options, h)).toEqual({
      ok: false,
      message: "Page 5: Broken.",
    });
  });
});
