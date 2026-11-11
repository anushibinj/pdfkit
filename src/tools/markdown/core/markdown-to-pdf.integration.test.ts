// @vitest-environment node
/** End to end: real `marked` + real ironpress WASM, no fakes. */
import init, { HtmlConverter } from "ironpress/node";
import { beforeAll, describe, expect, it } from "vitest";
import { allStreamText, pageSizes } from "../test-utils/pdf-inspect";
import { DEFAULT_STYLESHEET, SAMPLE_MARKDOWN } from "./default-stylesheet";
import { IronpressEngine } from "./ironpress-engine";
import { MarkedMarkdownRenderer } from "./markdown-renderer";
import { MarkdownToPdfConverter } from "./markdown-to-pdf";

let converter: MarkdownToPdfConverter;

beforeAll(async () => {
  await init();
  converter = new MarkdownToPdfConverter(
    new MarkedMarkdownRenderer(),
    new IronpressEngine({ HtmlConverter }),
  );
}, 60_000);

const embeddedFonts = (pdf: Uint8Array) =>
  new Set(
    [
      ...Buffer.from(pdf)
        .toString("latin1")
        .matchAll(/\/BaseFont \/[A-Z]{6}\+(Liberation\w+)/g),
    ].map((m) => m[1]),
  );

describe("Markdown to PDF, end to end", () => {
  it("converts the sample document with the default stylesheet", async () => {
    const pdf = converter.convert({
      markdown: SAMPLE_MARKDOWN,
      css: DEFAULT_STYLESHEET,
      page: { size: "A4", marginMm: 20 },
    });
    expect(await pageSizes(pdf)).toEqual([{ width: 595, height: 842 }]);
    const fonts = embeddedFonts(pdf);
    // body text is sans-serif; code spans and blocks are monospace
    expect([...fonts].some((f) => f.startsWith("LiberationSans"))).toBe(true);
    expect([...fonts].some((f) => f.startsWith("LiberationMono"))).toBe(true);
  });

  it("applies custom CSS to Markdown headings", () => {
    const page = { size: "A4", marginMm: 20 } as const;
    const plain = allStreamText(
      converter.convert({ markdown: "# Title", css: "", page }),
    );
    const styled = allStreamText(
      converter.convert({
        markdown: "# Title",
        css: "h1 { color: #ff0000; }",
        page,
      }),
    );
    expect(plain).not.toMatch(/\b1 0 0 rg\b/);
    expect(styled).toMatch(/\b1 0 0 rg\b/);
  });

  it("switches the body font through CSS", () => {
    const page = { size: "A4", marginMm: 20 } as const;
    const pdf = converter.convert({
      markdown: "Plain paragraph.",
      css: "body { font-family: serif; }",
      page,
    });
    expect(embeddedFonts(pdf)).toEqual(new Set(["LiberationSerif"]));
  });

  it("does not let a </style> in the CSS break the document", async () => {
    const pdf = converter.convert({
      markdown: "# Title",
      css: 'h1::after { content: "</style>"; } h1 { color: #ff0000; }',
      page: { size: "A4", marginMm: 20 },
    });
    // The rule after the escaped sequence is still parsed as CSS.
    expect(allStreamText(pdf)).toMatch(/\b1 0 0 rg\b/);
    expect((await pageSizes(pdf)).length).toBe(1);
  });
});
