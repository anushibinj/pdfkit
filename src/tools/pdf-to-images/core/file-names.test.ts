import { describe, expect, it } from "vitest";
import {
  archiveName,
  baseNameOf,
  extensionFor,
  extractedImageName,
  pageImageName,
  sequenceLabel,
} from "./file-names";

describe("baseNameOf", () => {
  it("drops the .pdf extension in any case", () => {
    expect(baseNameOf("Q3 report.pdf")).toBe("Q3 report");
    expect(baseNameOf("SCAN.PDF")).toBe("SCAN");
    expect(baseNameOf("notes")).toBe("notes");
  });

  it("replaces characters that are unsafe in file names", () => {
    expect(baseNameOf('a/b\\c:d*e?f"g<h>i|j.pdf')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(baseNameOf("tab\there.pdf")).toBe("tab_here");
  });

  it("trims dots and spaces at the ends and falls back to 'document'", () => {
    expect(baseNameOf(" .hidden. .pdf")).toBe("hidden");
    expect(baseNameOf(".pdf")).toBe("document");
    expect(baseNameOf("...")).toBe("document");
    expect(baseNameOf("../../etc.pdf")).toBe("_.._etc");
  });

  it("shortens very long names", () => {
    expect(baseNameOf(`${"x".repeat(300)}.pdf`)).toHaveLength(100);
  });
});

describe("sequenceLabel", () => {
  it("pads to the width of the total, at least two digits", () => {
    expect(sequenceLabel(3, 9)).toBe("03");
    expect(sequenceLabel(3, 12)).toBe("03");
    expect(sequenceLabel(7, 120)).toBe("007");
    expect(sequenceLabel(1, 0)).toBe("01");
  });
});

describe("file names", () => {
  it("names pages, images and archives after the PDF", () => {
    expect(pageImageName("report", 3, 12, "png")).toBe("report-page-03.png");
    expect(extractedImageName("report", 7, 150, "jpg")).toBe(
      "report-image-007.jpg",
    );
    expect(archiveName("report", "pages")).toBe("report-pages.zip");
    expect(archiveName("report", "images")).toBe("report-images.zip");
  });

  it("maps MIME types to extensions", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/png")).toBe("png");
  });
});
