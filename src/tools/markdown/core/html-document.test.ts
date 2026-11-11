import { describe, expect, it } from "vitest";
import { buildHtmlDocument, escapeStyleContent } from "./html-document";

describe("escapeStyleContent", () => {
  it("leaves ordinary CSS untouched", () => {
    const css = "h1 > a[href^='x'] { color: red; } /* comment */";
    expect(escapeStyleContent(css)).toBe(css);
  });

  it.each(["</style>", "</STYLE>", "</Style >", "</style/"])(
    "neutralises %j",
    (closer) => {
      const out = escapeStyleContent(`p::after { content: "${closer}"; }`);
      expect(out.toLowerCase()).not.toContain("</style");
      expect(out.toLowerCase()).toContain("<\\/style");
    },
  );

  it("escapes every occurrence", () => {
    expect(escapeStyleContent("</style></style>")).toBe("<\\/style><\\/style>");
  });
});

describe("buildHtmlDocument", () => {
  it("wraps the stylesheet and body in a UTF-8 HTML5 document", () => {
    const html = buildHtmlDocument({
      css: "p{color:red}",
      bodyHtml: "<p>Hi</p>",
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<style>p{color:red}</style>");
    expect(html).toContain("<body><p>Hi</p></body>");
    // charset must be declared before any content
    expect(html.indexOf("charset")).toBeLessThan(html.indexOf("<style>"));
  });

  it("keeps exactly one closing style tag even with hostile CSS", () => {
    const html = buildHtmlDocument({
      css: "</style><h1>injected</h1>",
      bodyHtml: "",
    });
    expect(html.match(/<\/style/gi)).toHaveLength(1);
  });
});
