import { describe, expect, it } from "vitest";
import type { PageSetup } from "../messages";
import type { MarkdownRenderer } from "./markdown-renderer";
import { MarkdownToPdfConverter } from "./markdown-to-pdf";
import { DEFAULT_PAGE_SETUP } from "./page-setup";
import type { PdfEngine } from "./pdf-engine";

class StubRenderer implements MarkdownRenderer {
  seen: string[] = [];
  render(markdown: string) {
    this.seen.push(markdown);
    return `<p>${markdown}</p>`;
  }
}

class SpyEngine implements PdfEngine {
  html = "";
  page: PageSetup | undefined;
  render(html: string, page: PageSetup) {
    this.html = html;
    this.page = page;
    return new Uint8Array([37, 80, 68, 70]); // "%PDF"
  }
}

describe("MarkdownToPdfConverter", () => {
  it("renders Markdown, wraps it with the CSS and hands it to the engine", () => {
    const renderer = new StubRenderer();
    const engine = new SpyEngine();
    const pdf = new MarkdownToPdfConverter(renderer, engine).convert({
      markdown: "hello",
      css: "p { color: red; }",
      page: { size: "Legal", marginMm: 10 },
    });
    expect(Array.from(pdf)).toEqual([37, 80, 68, 70]);
    expect(renderer.seen).toEqual(["hello"]);
    expect(engine.html).toContain("<style>p { color: red; }</style>");
    expect(engine.html).toContain("<body><p>hello</p></body>");
    expect(engine.page).toEqual({ size: "Legal", marginMm: 10 });
  });

  it("normalises untrusted page settings and CSS", () => {
    const engine = new SpyEngine();
    new MarkdownToPdfConverter(new StubRenderer(), engine).convert({
      markdown: "x",
      css: undefined as never,
      page: { size: "Tabloid" as never, marginMm: Number.NaN },
    });
    expect(engine.page).toEqual(DEFAULT_PAGE_SETUP);
    expect(engine.html).toContain("<style></style>");
  });

  it("lets engine errors propagate", () => {
    const engine: PdfEngine = {
      render() {
        throw new Error("engine broke");
      },
    };
    const converter = new MarkdownToPdfConverter(new StubRenderer(), engine);
    expect(() =>
      converter.convert({ markdown: "", css: "", page: DEFAULT_PAGE_SETUP }),
    ).toThrow("engine broke");
  });
});
