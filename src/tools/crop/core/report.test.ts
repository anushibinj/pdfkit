import { describe, expect, it } from "vitest";
import {
  EMPTY_REPORT,
  NOTABLE_TEXT_SHIFT,
  describeReport,
  joinList,
  parseCropReport,
  plural,
} from "./report";

describe("parseCropReport", () => {
  it("reads every field of the module's JSON", () => {
    const report = parseCropReport(
      '{"pagesCropped":2,"glyphsRemoved":5,"maxTextShift":0.25,"extra":9}',
    );
    expect(report).toEqual({
      ...EMPTY_REPORT,
      pagesCropped: 2,
      glyphsRemoved: 5,
      maxTextShift: 0.25,
    });
  });

  it("treats garbage as zero", () => {
    expect(parseCropReport("not json")).toEqual(EMPTY_REPORT);
    expect(parseCropReport("null")).toEqual(EMPTY_REPORT);
    expect(parseCropReport('{"pagesCropped":-1,"glyphsRemoved":"5"}')).toEqual(
      EMPTY_REPORT,
    );
  });
});

describe("describeReport", () => {
  it("says plainly that hiding only keeps the content", () => {
    const d = describeReport({ ...EMPTY_REPORT, pagesCropped: 1 }, false);
    expect(d.summary).toBe(
      "Cropped 1 page. The content outside the crop area is hidden, not removed: it is still in the file.",
    );
    expect(d.kept).toEqual([]);
  });

  it("lists what was removed", () => {
    const d = describeReport(
      {
        ...EMPTY_REPORT,
        pagesCropped: 3,
        glyphsRemoved: 1200,
        pathsRemoved: 1,
        annotationsRemoved: 2,
      },
      true,
    );
    expect(d.summary).toBe(
      "Cropped 3 pages and removed what was outside: 1,200 characters, 1 line or shape and 2 annotations.",
    );
  });

  it("says when nothing visible was outside", () => {
    expect(
      describeReport({ ...EMPTY_REPORT, pagesCropped: 1 }, true).summary,
    ).toContain("Nothing visible lay outside");
  });

  it("lists everything that stays in the file", () => {
    const d = describeReport(
      {
        ...EMPTY_REPORT,
        pagesCropped: 1,
        imagesKeptCrossing: 2,
        textKeptUnmeasured: 1,
        formFieldsKept: 1,
        streamsNotAnalysed: 1,
        streamsPartlyAnalysed: 1,
      },
      true,
    );
    expect(d.kept).toHaveLength(4);
    expect(d.kept[0]).toContain("2 pictures cross");
    expect(d.kept[0]).toContain("were kept whole");
    expect(d.kept[1]).toContain("if any lies outside the crop area");
    expect(d.kept[2]).toContain("1 form field lies");
    expect(d.kept[3]).toContain("2 parts");
  });

  it("mentions a noticeable shift in Chrome only above the threshold", () => {
    const small = describeReport(
      { ...EMPTY_REPORT, pagesCropped: 1, maxTextShift: 0.2 },
      true,
    );
    expect(small.notes).toEqual([]);
    const large = describeReport(
      {
        ...EMPTY_REPORT,
        pagesCropped: 1,
        maxTextShift: NOTABLE_TEXT_SHIFT + 0.24,
      },
      true,
    );
    expect(large.notes[0]).toContain("up to 0.7 pt");
  });
});

describe("plural and joinList", () => {
  it("pluralise and join in plain English", () => {
    expect(plural(1, "page", "pages")).toBe("1 page");
    expect(plural(1000, "page", "pages")).toBe("1,000 pages");
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});
