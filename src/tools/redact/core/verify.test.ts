import { describe, expect, it } from "vitest";
import type { RedactionMark } from "./model";
import type { PageCharWithBox } from "./text-search";
import { verifyRedactedOutput } from "./verify";

function charsFor(text: string, startX: number, y: number): PageCharWithBox[] {
  return [...text].map((char, i) => ({
    char,
    x: startX + i * 6,
    y,
    box: {
      left: startX + i * 6,
      bottom: y - 2,
      right: startX + (i + 1) * 6,
      top: y + 10,
    },
    textObjectIndex: 0,
  }));
}

function makeMark(
  id: string,
  term: string,
  left: number,
  right: number,
  enabled = true,
): RedactionMark {
  return {
    id,
    pageIndex: 0,
    box: { left, bottom: 695, right, top: 715 },
    term,
    source: "text",
    label: "Text",
    enabled,
  };
}

describe("verifyRedactedOutput", () => {
  it("reports 0 of N redacted terms remain when all enabled terms and box interiors are gone", () => {
    const cleanBytes = new TextEncoder().encode("%PDF-1.7\n...\n%%EOF\n");
    const marks = [
      makeMark("m1", "alice@example.com", 50, 150, true),
      makeMark("m2", "REDACTED_LABEL_OK", 200, 260, true),
    ];
    // Only the overlay label "REDACTED" sits inside m1's box; unrelated text sits elsewhere.
    const reopenedPages = [
      [...charsFor("REDACTED", 55, 700), ...charsFor("Public info", 300, 700)],
    ];

    const report = verifyRedactedOutput({
      allMarks: marks,
      overlayLabel: "REDACTED",
      reopenedPages,
      outputPdfBytes: cleanBytes,
    });

    expect(report.verified).toBe(true);
    expect(report.remainingTerms).toBe(0);
    expect(report.summary).toBe("0 of 2 redacted terms remain");
  });

  it("allows intentionally unticked false-positive occurrences to remain", () => {
    const cleanBytes = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    const marks = [
      makeMark("m1", "1234", 50, 80, true),
      makeMark("m2", "1234", 200, 230, false), // unticked false positive
    ];
    const reopenedPages = [charsFor("1234", 200, 700)];

    const report = verifyRedactedOutput({
      allMarks: marks,
      overlayLabel: "",
      reopenedPages,
      outputPdfBytes: cleanBytes,
    });

    expect(report.verified).toBe(true);
    expect(report.summary).toBe("0 of 1 redacted terms remain");
  });

  it("fails verification when a redacted term, interior glyph, or duplicate %%EOF remains", () => {
    const cleanBytes = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    const marks = [makeMark("m1", "SECRET_PAN", 50, 110, true)];

    const leakedText = verifyRedactedOutput({
      allMarks: marks,
      overlayLabel: "REDACTED",
      reopenedPages: [charsFor("SECRET_PAN", 300, 700)],
      outputPdfBytes: cleanBytes,
    });
    expect(leakedText.verified).toBe(false);
    expect(leakedText.remainingTerms).toBe(1);
    expect(leakedText.summary).toBe("1 of 1 redacted terms remain");

    const leakedPartialGlyph = verifyRedactedOutput({
      allMarks: marks,
      overlayLabel: "REDACTED",
      reopenedPages: [charsFor("SEC", 55, 700)],
      outputPdfBytes: cleanBytes,
    });
    expect(leakedPartialGlyph.verified).toBe(false);

    const incrementalBytes = new TextEncoder().encode(
      "%PDF-1.7\n%%EOF\n%update\n%%EOF\n",
    );
    const leakedRevision = verifyRedactedOutput({
      allMarks: marks,
      overlayLabel: "",
      reopenedPages: [[]],
      outputPdfBytes: incrementalBytes,
    });
    expect(leakedRevision.verified).toBe(false);
  });
});
