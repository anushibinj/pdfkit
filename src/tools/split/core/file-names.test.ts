import { describe, expect, it } from "vitest";
import {
  baseName,
  outputFileNames,
  pagesLabel,
  uniqueNames,
  zipFileName,
} from "./file-names";

describe("baseName", () => {
  it.each([
    ["Report 2024.pdf", "Report 2024"],
    ["scan.PDF", "scan"],
    ["notes", "notes"],
    ['a<b>c:d"e/f\\g|h?i*j.pdf', "a_b_c_d_e_f_g_h_i_j"],
    ["tab\there.pdf", "tab_here"],
    ["dots....pdf", "dots"],
    [".pdf", "document"],
    ["   ", "document"],
  ])("%j -> %j", (input, expected) => {
    expect(baseName(input)).toBe(expected);
  });
});

describe("pagesLabel", () => {
  it.each([
    [[3], "page-4"],
    [[0, 1, 2], "pages-1-3"],
    [[0, 1, 2, 4], "pages-1-3_5"],
    [[2, 0], "pages-3_1"],
  ])("%j -> %s", (pages, label) => {
    expect(pagesLabel(pages)).toBe(label);
  });
});

describe("outputFileNames", () => {
  it("names split files by their pages", () => {
    expect(
      outputFileNames("book.pdf", "split", [
        { pages: [0, 1, 2] },
        { pages: [3] },
      ]),
    ).toEqual(["book-pages-1-3.pdf", "book-page-4.pdf"]);
  });

  it("names extract and remove results after what was done", () => {
    expect(outputFileNames("book.pdf", "extract", [{ pages: [1] }])).toEqual([
      "book-extracted.pdf",
    ]);
    expect(outputFileNames("book.pdf", "remove", [{ pages: [1] }])).toEqual([
      "book-pages-removed.pdf",
    ]);
  });

  it("makes repeated ranges unique", () => {
    expect(
      outputFileNames("b.pdf", "split", [
        { pages: [0] },
        { pages: [0] },
        { pages: [0] },
      ]),
    ).toEqual(["b-page-1.pdf", "b-page-1 (2).pdf", "b-page-1 (3).pdf"]);
  });
});

describe("uniqueNames", () => {
  it("never reuses a name that already appeared", () => {
    expect(uniqueNames(["a", "a (2)", "a", "a"])).toEqual([
      "a",
      "a (2)",
      "a (3)",
      "a (4)",
    ]);
  });
});

describe("zipFileName", () => {
  it("adds -split.zip to the base name", () => {
    expect(zipFileName("My Book.pdf")).toBe("My Book-split.zip");
    expect(zipFileName("")).toBe("document-split.zip");
  });
});
