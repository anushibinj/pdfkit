import { describe, expect, it } from "vitest";
import { HTML_ACCEPT, isHtmlFile, pdfNameForHtml } from "./file-names";

describe("isHtmlFile", () => {
  it.each(["a.html", "A.HTM", "page.xhtml", "page.xht"])(
    "accepts %s by extension",
    (name) => {
      expect(isHtmlFile({ name, type: "" })).toBe(true);
    },
  );

  it.each(["text/html", "application/xhtml+xml"])(
    "accepts the %s MIME type",
    (type) => {
      expect(isHtmlFile({ name: "page", type })).toBe(true);
    },
  );

  it.each([
    ["notes.md", "text/markdown"],
    ["report.pdf", "application/pdf"],
    ["page.html.exe", ""],
    ["page.mhtml", "multipart/related"],
  ])("rejects %s", (name, type) => {
    expect(isHtmlFile({ name, type })).toBe(false);
  });

  it("lists the same extensions in the picker filter", () => {
    for (const ext of [".html", ".htm", ".xhtml", ".xht"]) {
      expect(HTML_ACCEPT.split(",")).toContain(ext);
    }
  });
});

describe("pdfNameForHtml", () => {
  it.each([
    ["invoice.html", "invoice.pdf"],
    ["Report.HTM", "Report.pdf"],
    ["page.xhtml", "page.pdf"],
    ["archive.tar", "archive.tar.pdf"],
    [".html", "document.pdf"],
    [undefined, "document.pdf"],
  ])("%j -> %s", (input, expected) => {
    expect(pdfNameForHtml(input)).toBe(expected);
  });
});
