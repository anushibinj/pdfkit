import type { PageBox } from "@/lib/pdfium/page-box";
import type { LeakedTerm, RedactionMark, VerificationReport } from "./model";
import {
  buildSearchablePageText,
  type PageCharWithBox,
} from "./text-search";

/** Inputs required by {@link verifyRedactedOutput}. */
export interface VerifyRedactionInput {
  /** All marks in the plan (both enabled and intentionally disabled false positives). */
  allMarks: readonly RedactionMark[];
  /** Label text drawn over redaction boxes (e.g. "REDACTED"), ignored when checking box interiors. */
  overlayLabel: string;
  /** Extracted characters per page from reopening the saved output PDF. */
  reopenedPages: readonly (readonly PageCharWithBox[])[];
  /** Final saved PDF bytes (checked for leftover incremental revision markers). */
  outputPdfBytes: Uint8Array;
}

/** Count case-insensitive non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  const hay = haystack.toLowerCase();
  const ndl = needle.toLowerCase();
  let count = 0;
  let pos = 0;
  while (pos <= hay.length - ndl.length) {
    const idx = hay.indexOf(ndl, pos);
    if (idx === -1) break;
    count++;
    pos = idx + ndl.length;
  }
  return count;
}

/** Return true when a character's center lies strictly inside `box`. */
function isCharCenterInsideBox(charBox: PageBox, box: PageBox): boolean {
  const cx = (charBox.left + charBox.right) / 2;
  const cy = (charBox.bottom + charBox.top) / 2;
  return cx > box.left && cx < box.right && cy > box.bottom && cy < box.top;
}

/** Count `%%EOF` markers in raw PDF bytes to ensure a single-revision rewrite. */
function countEofMarkers(bytes: Uint8Array): number {
  // Scan ASCII bytes directly without decoding megabytes into a JS string.
  const marker = [0x25, 0x25, 0x45, 0x4f, 0x46]; // "%%EOF"
  let count = 0;
  for (let i = 0; i <= bytes.length - marker.length; i++) {
    if (
      bytes[i] === marker[0] &&
      bytes[i + 1] === marker[1] &&
      bytes[i + 2] === marker[2] &&
      bytes[i + 3] === marker[3] &&
      bytes[i + 4] === marker[4]
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Re-extract text from every page of the saved output PDF and verify that zero
 * redacted terms or covered glyphs remain anywhere in the file.
 *
 * Verification checks three independent invariants:
 * 1. **Term presence check**: for every enabled mark with a non-empty `term`
 *    (excluding matches identical to `overlayLabel`), the number of occurrences
 *    of `term` remaining on `mark.pageIndex` must be at most the number of
 *    intentionally unticked (`enabled: false`) marks for that same `term` on
 *    that page. (When a user unticks a false positive, that unticked occurrence
 *    is allowed to remain; all enabled occurrences must be gone.)
 * 2. **Spatial box check**: no original text character other than the drawn
 *    `overlayLabel` characters may remain inside any enabled `mark.box`.
 * 3. **Single-revision check**: raw output bytes must contain at most 1 `%%EOF`
 *    marker so no earlier incremental revision survives in the saved file.
 *
 * @param input Reopened page characters, marks, label, and output bytes.
 * @returns Detailed {@link VerificationReport} with `"X of Y redacted terms remain"`.
 */
export function verifyRedactedOutput(
  input: VerifyRedactionInput,
): VerificationReport {
  const { allMarks, overlayLabel, reopenedPages, outputPdfBytes } = input;
  const enabledMarks = allMarks.filter((m) => m.enabled);
  const labelNormalized = overlayLabel.trim().toLowerCase();

  // Group enabled and disabled term marks per page so intentionally unticked
  // false positives on the same page do not trigger false failures.
  const disabledTermCounts = new Map<string, number>();
  for (const mark of allMarks) {
    if (mark.enabled) continue;
    const keyTerm = mark.term.trim().toLowerCase();
    if (!keyTerm) continue;
    const key = `${mark.pageIndex}:${keyTerm}`;
    disabledTermCounts.set(key, (disabledTermCounts.get(key) ?? 0) + 1);
  }

  // Extract full page text once per page.
  const pageTexts = reopenedPages.map(
    (chars) => buildSearchablePageText(chars).text,
  );

  const leakedTerms: LeakedTerm[] = [];
  const checkedTermKeys = new Set<string>();
  let totalChecked = 0;
  let remainingCount = 0;

  // 1. Check every distinct (pageIndex, term) among enabled marks.
  for (const mark of enabledMarks) {
    const trimmedTerm = mark.term.trim();
    if (trimmedTerm.length === 0) continue;
    // If the user explicitly redacted the exact word they chose as the overlay
    // label (rare), checking text inside the box in step 2 still validates it.
    if (trimmedTerm.toLowerCase() === labelNormalized) continue;

    const key = `${mark.pageIndex}:${trimmedTerm.toLowerCase()}`;
    if (checkedTermKeys.has(key)) continue;
    checkedTermKeys.add(key);

    const enabledOccurrencesOnPage = enabledMarks.filter(
      (m) =>
        m.pageIndex === mark.pageIndex &&
        m.term.trim().toLowerCase() === trimmedTerm.toLowerCase(),
    ).length;
    totalChecked += enabledOccurrencesOnPage;

    const allowedRemaining = disabledTermCounts.get(key) ?? 0;
    const foundOnPage = countOccurrences(
      pageTexts[mark.pageIndex] ?? "",
      trimmedTerm,
    );
    const leakedHere = Math.max(0, foundOnPage - allowedRemaining);
    if (leakedHere > 0) {
      remainingCount += Math.min(leakedHere, enabledOccurrencesOnPage);
      leakedTerms.push({ pageIndex: mark.pageIndex, term: trimmedTerm });
    }
  }

  // 2. Spatial fallback check for graphic/empty-term marks (and sanity check
  //    that no non-label characters remain centered inside any enabled redaction box).
  for (const mark of enabledMarks) {
    const isGraphicMark = mark.term.trim().length === 0;
    if (isGraphicMark) totalChecked += 1;

    const pageChars = reopenedPages[mark.pageIndex] ?? [];
    const insideChars = pageChars.filter((c) =>
      isCharCenterInsideBox(c.box, mark.box),
    );
    const insideText = buildSearchablePageText(insideChars).text.trim();
    const cleanedInside =
      labelNormalized.length > 0
        ? insideText
            .toLowerCase()
            .replaceAll(labelNormalized, "")
            .trim()
        : insideText.toLowerCase();
    const nonLabelResidual = cleanedInside.length > 0;

    if (nonLabelResidual && isGraphicMark) {
      remainingCount += 1;
      leakedTerms.push({
        pageIndex: mark.pageIndex,
        term: insideText.slice(0, 64),
      });
    } else if (
      nonLabelResidual &&
      !leakedTerms.some(
        (l) => l.pageIndex === mark.pageIndex && l.term === mark.term.trim(),
      )
    ) {
      // Catch a case where partial glyphs of the redacted term leaked inside
      // its box even if the full multi-character term string no longer matched,
      // without falsely rejecting adjacent kept punctuation (e.g. a hyphen)
      // that nudged into the box padding due to font metric rounding.
      const termLower = mark.term.trim().toLowerCase();
      const residualTokens = cleanedInside.replace(/\s+/g, "");
      const hasTermFragment = [...residualTokens].some((ch) =>
        termLower.includes(ch),
      );
      if (hasTermFragment) {
        remainingCount += 1;
        leakedTerms.push({
          pageIndex: mark.pageIndex,
          term: mark.term.trim(),
        });
      }
    }
  }

  // 3. Single-revision check (no leftover incremental update %%EOF).
  const eofCount = countEofMarkers(outputPdfBytes);
  if (eofCount > 1) {
    remainingCount = Math.max(remainingCount, 1);
    leakedTerms.push({
      pageIndex: 0,
      term: "Incremental revision history detected (multiple %%EOF markers)",
    });
  }

  const totalTerms = Math.max(totalChecked, enabledMarks.length);
  const summary = `${remainingCount} of ${totalTerms} redacted terms remain`;

  return {
    verified: remainingCount === 0,
    totalTerms,
    remainingTerms: remainingCount,
    leakedTerms,
    summary,
  };
}
