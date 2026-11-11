import { describe, expect, it } from "vitest";
import { isMarkdownFile, pdfNameForMarkdown } from "./file-names";

describe("isMarkdownFile", () => {
  it.each(["a.md", "A.MD", "notes.markdown", "x.mdown", "x.mkd", "readme.txt"])(
    "accepts %s by extension",
    (name) => {
      expect(isMarkdownFile({ name, type: "" })).toBe(true);
    },
  );

  it.each(["text/markdown", "text/x-markdown", "text/plain"])(
    "accepts the %s MIME type",
    (type) => {
      expect(isMarkdownFile({ name: "README", type })).toBe(true);
    },
  );

  it.each([
    ["report.pdf", "application/pdf"],
    ["image.png", "image/png"],
    ["notes.md.exe", ""],
  ])("rejects %s", (name, type) => {
    expect(isMarkdownFile({ name, type })).toBe(false);
  });
});

describe("pdfNameForMarkdown", () => {
  it.each([
    ["notes.md", "notes.pdf"],
    ["Notes.MARKDOWN", "Notes.pdf"],
    ["readme.txt", "readme.pdf"],
    ["archive.tar", "archive.tar.pdf"],
    [".md", "document.pdf"],
    ["  ", "document.pdf"],
    [undefined, "document.pdf"],
  ])("%j -> %s", (input, expected) => {
    expect(pdfNameForMarkdown(input)).toBe(expected);
  });
});
