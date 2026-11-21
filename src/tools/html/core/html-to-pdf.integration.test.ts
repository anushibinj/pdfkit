// @vitest-environment node
/**
 * Runs the real ironpress WebAssembly build (from node_modules) to pin down
 * every engine behaviour the HTML to PDF tool relies on or works around. If
 * an ironpress upgrade changes any of it, these tests fail before users
 * notice (for example, a fixed `hidden` attribute would fail the "engine
 * gap" test and tell us the workaround can go).
 */
import init, { HtmlConverter } from "ironpress/node";
import { beforeAll, describe, expect, it } from "vitest";
import { IronpressEngine } from "@/lib/html-pdf/ironpress-engine";
import {
  allStreamText,
  pageSizes,
} from "@/lib/html-pdf/test-utils/pdf-inspect";
import type { PageSetup } from "@/lib/html-pdf/types";
import { HtmlToPdfConverter } from "./html-to-pdf";
import { SAMPLE_HTML } from "./sample-html";
import { UNSUPPORTED_IMAGE_TYPES } from "./skipped-resources";

const A4: PageSetup = { size: "A4", marginMm: 20 };

/** "1 0 0 rg" sets the fill colour to pure red: the marker for "drawn". */
const RED = /\b1 0 0 rg\b/;

/** A 1x1 red PNG. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

/**
 * Valid images in the formats the engine does not draw. Each one decodes in
 * Chromium (checked when this test was written), so "not drawn" means the
 * format is refused, not that the test data is broken.
 */
const VALID_IMAGES: Record<string, string> = {
  "image/gif": "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  "image/webp": "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
  "image/svg+xml": Buffer.from(
    "<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'><rect width='4' height='4'/></svg>",
  ).toString("base64"),
};

let engine: IronpressEngine;
let converter: HtmlToPdfConverter;

beforeAll(async () => {
  await init();
  engine = new IronpressEngine({ HtmlConverter });
  converter = new HtmlToPdfConverter(engine);
}, 60_000);

/** Convert HTML with the real engine (A4, 20 mm by default). */
const convert = (html: string, page: PageSetup = A4) =>
  converter.convert({ html, page });

/** True when the red marker colour is used anywhere in the PDF. */
const drawsRed = (html: string) => RED.test(allStreamText(convert(html)));

/** Number of embedded images in a PDF. */
const imageCount = (pdf: Uint8Array) =>
  (
    Buffer.from(pdf)
      .toString("latin1")
      .match(/\/Subtype\s*\/Image/g) ?? []
  ).length;

/**
 * The content area of the first page as "x y width height", read from the
 * clip rectangle ("x y w h re W n") that ironpress draws around the content.
 */
const contentBox = (pdf: Uint8Array) =>
  allStreamText(pdf)
    .match(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re\s+W n/)
    ?.slice(1, 5)
    .map((n) => Math.round(Number(n)))
    .join(" ");

describe("HTML to PDF with the real WASM build", () => {
  it("converts the sample document to one A4 page in Liberation Sans", async () => {
    const pdf = convert(SAMPLE_HTML);
    expect(await pageSizes(pdf)).toEqual([{ width: 595, height: 842 }]);
    expect(Buffer.from(pdf).toString("latin1")).toMatch(
      /\/BaseFont \/[A-Z]{6}\+LiberationSans/,
    );
  });

  it("converts fragments, full documents and empty input", async () => {
    expect(drawsRed("<p style='color:#ff0000'>fragment</p>")).toBe(true);
    expect(
      drawsRed(
        "<!doctype html><html><head><style>p{color:#ff0000}</style></head><body><p>x</p></body></html>",
      ),
    ).toBe(true);
    expect(await pageSizes(convert(""))).toHaveLength(1);
  });

  describe("browser defaults the engine lacks", () => {
    it("engine gap: ironpress alone draws hidden elements", () => {
      const raw = engine.render("<p hidden style='color:#ff0000'>x</p>", A4);
      expect(allStreamText(raw)).toMatch(RED);
    });

    it("hides elements with the hidden attribute", () => {
      expect(drawsRed("<p hidden style='color:#ff0000'>secret</p>")).toBe(
        false,
      );
      expect(
        drawsRed("<!doctype html><p hidden style='color:#ff0000'>secret</p>"),
      ).toBe(false);
    });

    it("lets the document's own CSS override the defaults, as in a browser", () => {
      expect(
        drawsRed(
          "<style>p { display: block }</style><p hidden style='color:#ff0000'>x</p>",
        ),
      ).toBe(true);
    });

    it("hides the body of a closed <details> but keeps its summary", () => {
      expect(
        drawsRed(
          "<details><summary>s</summary><p style='color:#ff0000'>in</p></details>",
        ),
      ).toBe(false);
      expect(
        drawsRed(
          "<details><summary style='color:#ff0000'>s</summary><p>in</p></details>",
        ),
      ).toBe(true);
      expect(
        drawsRed(
          "<details open><summary>s</summary><p style='color:#ff0000'>in</p></details>",
        ),
      ).toBe(true);
    });

    it("hides a closed <dialog> and shows an open one", () => {
      expect(drawsRed("<dialog><p style='color:#ff0000'>in</p></dialog>")).toBe(
        false,
      );
      expect(
        drawsRed("<dialog open><p style='color:#ff0000'>in</p></dialog>"),
      ).toBe(true);
    });

    it("keeps the document's own head styles working after the inserted style", () => {
      const html =
        "<!DOCTYPE html><html lang='en'><head><style>h1{color:#ff0000}</style></head><body><h1>Hi</h1></body></html>";
      expect(drawsRed(html)).toBe(true);
    });
  });

  describe("@page rules in the HTML win over the page settings", () => {
    it("for the paper size", async () => {
      const pdf = convert("<style>@page { size: A5 }</style><p>x</p>");
      expect(await pageSizes(pdf)).toEqual([{ width: 420, height: 595 }]);
    });

    it("for the margins", () => {
      // 20 mm = 57 pt: the settings' content box starts at 57,57.
      expect(contentBox(convert("<p>x</p>"))).toBe("57 57 482 729");
      expect(
        contentBox(convert("<style>@page { margin: 0 }</style><p>x</p>")),
      ).toBe("0 0 595 842");
    });
  });

  describe("resources the engine cannot load are skipped, not fatal", () => {
    it("draws embedded PNG and JPEG data: images", () => {
      const html = `<img src="data:image/png;base64,${PNG_BASE64}" width="20" height="20">`;
      expect(imageCount(convert(html))).toBeGreaterThan(0);
    });

    it("draws a data: image by its bytes, whatever type it declares", () => {
      const html = `<img src="data:image/jpeg;base64,${PNG_BASE64}" width="20" height="20">`;
      expect(imageCount(convert(html))).toBeGreaterThan(0);
    });

    it.each([
      "https://example.com/logo.png",
      "logo.png",
      "file:///etc/hosts",
      "data:image/png;base64,AAAA",
    ])("skips <img src=%j> and still converts", (src) => {
      const pdf = convert(`<p>before</p><img src="${src}"><p>after</p>`);
      expect(imageCount(pdf)).toBe(0);
    });

    it.each([...UNSUPPORTED_IMAGE_TYPES])(
      "skips an embedded %s image (the scan's deny list is accurate)",
      (type) => {
        const pdf = convert(
          `<img src="data:${type};base64,${VALID_IMAGES[type]}" width="20" height="20">`,
        );
        expect(imageCount(pdf)).toBe(0);
      },
    );

    it("ignores linked stylesheets, even data: ones", () => {
      expect(
        drawsRed(
          "<link rel=stylesheet href='data:text/css,p%7Bcolor%3A%23ff0000%7D'><p>x</p>",
        ),
      ).toBe(false);
    });

    it("drops scripts and their output", () => {
      expect(
        drawsRed(
          "<p>a</p><script>document.write('<p style=color:#ff0000>x</p>')</script>",
        ),
      ).toBe(false);
    });
  });
});
