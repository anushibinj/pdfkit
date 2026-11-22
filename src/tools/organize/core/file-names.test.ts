import { describe, expect, it } from "vitest";
import type { BoardPage, BoardSource } from "./board";
import { COMBINED_FILE_NAME, outputFileName } from "./file-names";

const sources: BoardSource[] = ["report.pdf", "scan.PDF"].map((name, i) => ({
  id: `s${i}`,
  name,
  pages: [],
  colorIndex: i,
  passwordProtected: false,
}));
let n = 0;
const page = (sourceId: string): BoardPage => ({
  kind: "source",
  key: `k${++n}`,
  sourceId,
  pageIndex: 0,
  rotation: 0,
});
const blank: BoardPage = {
  kind: "blank",
  key: "b",
  width: 10,
  height: 10,
  rotation: 0,
};

describe("outputFileName", () => {
  it("names a single file's re-arrangement after it", () => {
    expect(outputFileName([page("s0"), blank, page("s0")], sources)).toBe(
      "report-organized.pdf",
    );
    expect(outputFileName([page("s1")], sources)).toBe("scan-organized.pdf");
  });

  it("uses the combined name for several files or none", () => {
    expect(outputFileName([page("s0"), page("s1")], sources)).toBe(
      COMBINED_FILE_NAME,
    );
    expect(outputFileName([blank], sources)).toBe(COMBINED_FILE_NAME);
    expect(outputFileName([page("gone")], sources)).toBe(COMBINED_FILE_NAME);
  });
});
