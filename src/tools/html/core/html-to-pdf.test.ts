import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SETUP } from "@/lib/html-pdf/page-setup";
import type { PdfEngine } from "@/lib/html-pdf/pdf-engine";
import type { PageSetup } from "@/lib/html-pdf/types";
import { BROWSER_DEFAULTS_STYLE } from "./browser-defaults";
import { HtmlToPdfConverter } from "./html-to-pdf";

/** Records what it was asked to render and returns a fixed "%PDF". */
class SpyEngine implements PdfEngine {
  html = "";
  page: PageSetup | undefined;
  /** Remember the HTML and page settings, then return four fake PDF bytes. */
  render(html: string, page: PageSetup) {
    this.html = html;
    this.page = page;
    return new Uint8Array([37, 80, 68, 70]); // "%PDF"
  }
}

describe("HtmlToPdfConverter", () => {
  it("adds the browser defaults and hands the HTML to the engine", () => {
    const engine = new SpyEngine();
    const pdf = new HtmlToPdfConverter(engine).convert({
      html: "<!doctype html><p>Hi</p>",
      page: { size: "Letter", marginMm: 10 },
    });
    expect(Array.from(pdf)).toEqual([37, 80, 68, 70]);
    expect(engine.html).toBe(
      `<!doctype html>${BROWSER_DEFAULTS_STYLE}<p>Hi</p>`,
    );
    expect(engine.page).toEqual({ size: "Letter", marginMm: 10 });
  });

  it("uses an injected preparer instead of the default", () => {
    const engine = new SpyEngine();
    new HtmlToPdfConverter(engine, (html) => html.toUpperCase()).convert({
      html: "<p>x</p>",
      page: DEFAULT_PAGE_SETUP,
    });
    expect(engine.html).toBe("<P>X</P>");
  });

  it("normalises untrusted page settings and a missing document", () => {
    const engine = new SpyEngine();
    new HtmlToPdfConverter(engine, (html) => html).convert({
      html: undefined as never,
      page: { size: "Tabloid" as never, marginMm: Number.NaN },
    });
    expect(engine.page).toEqual(DEFAULT_PAGE_SETUP);
    expect(engine.html).toBe("");
  });

  it("lets engine errors propagate to the worker", () => {
    const engine: PdfEngine = {
      render() {
        throw new Error("engine broke");
      },
    };
    expect(() =>
      new HtmlToPdfConverter(engine).convert({
        html: "",
        page: DEFAULT_PAGE_SETUP,
      }),
    ).toThrow("engine broke");
  });
});
