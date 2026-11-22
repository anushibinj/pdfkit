/**
 * What the pdf-crop module did, as it reports it (`report.rs`), with every
 * count present.
 */
export interface CropReport {
  pagesCropped: number;
  glyphsRemoved: number;
  pathsRemoved: number;
  imagesRemoved: number;
  formsRemoved: number;
  formsTrimmed: number;
  annotationsRemoved: number;
  imagesKeptCrossing: number;
  textKeptUnmeasured: number;
  formFieldsKept: number;
  streamsNotAnalysed: number;
  streamsPartlyAnalysed: number;
  /** Points kept text can move in viewers that round glyph widths (PDFium). */
  maxTextShift: number;
}

const FIELDS: readonly (keyof CropReport)[] = [
  "pagesCropped",
  "glyphsRemoved",
  "pathsRemoved",
  "imagesRemoved",
  "formsRemoved",
  "formsTrimmed",
  "annotationsRemoved",
  "imagesKeptCrossing",
  "textKeptUnmeasured",
  "formFieldsKept",
  "streamsNotAnalysed",
  "streamsPartlyAnalysed",
  "maxTextShift",
];

/** A report with every count 0. */
export const EMPTY_REPORT: CropReport = Object.fromEntries(
  FIELDS.map((f) => [f, 0]),
) as unknown as CropReport;

/**
 * Read the module's report. Missing, negative or non-numeric values count
 * as 0, so a report from an older or broken module cannot crash the UI.
 *
 * @param json The JSON text (or anything).
 * @returns The report.
 */
export function parseCropReport(json: string): CropReport {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ...EMPTY_REPORT };
  }
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const report = { ...EMPTY_REPORT };
  for (const field of FIELDS) {
    const value = record[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      report[field] = value;
    }
  }
  return report;
}

/** A report in words, for the result panel. */
export interface ReportSummary {
  /** One sentence: what was done. */
  summary: string;
  /**
   * What could not be removed and stays in the file (only when content
   * outside was to be removed), so nobody assumes it is gone.
   */
  kept: string[];
  /** Other things worth knowing that are not about hidden content. */
  notes: string[];
}

/** Kept text moving less than this (in points) is not worth mentioning. */
export const NOTABLE_TEXT_SHIFT = 0.5;

/**
 * Describe a report in plain words.
 *
 * @param report The module's report.
 * @param removeOutside Whether content outside was to be removed.
 * @returns The summary, what stays in the file, and notes.
 */
export function describeReport(
  report: CropReport,
  removeOutside: boolean,
): ReportSummary {
  const pages = plural(report.pagesCropped, "page", "pages");
  if (!removeOutside) {
    return {
      summary: `Cropped ${pages}. The content outside the crop area is hidden, not removed: it is still in the file.`,
      kept: [],
      notes: [],
    };
  }
  const removed = [
    [report.glyphsRemoved, "character", "characters"],
    [report.pathsRemoved, "line or shape", "lines and shapes"],
    [report.imagesRemoved, "picture", "pictures"],
    [report.formsRemoved, "content group", "content groups"],
    [report.annotationsRemoved, "annotation", "annotations"],
  ] as const;
  const parts = removed
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => plural(n, one, many));
  const summary =
    parts.length > 0
      ? `Cropped ${pages} and removed what was outside: ${joinList(parts)}.`
      : `Cropped ${pages}. Nothing visible lay outside the crop area.`;

  const kept: string[] = [];
  if (report.imagesKeptCrossing > 0) {
    kept.push(
      `${plural(report.imagesKeptCrossing, "picture crosses", "pictures cross")} the edge of the crop area and ${report.imagesKeptCrossing === 1 ? "was" : "were"} kept whole, so the part outside is hidden, not removed.`,
    );
  }
  if (report.textKeptUnmeasured > 0) {
    kept.push(
      `Some text is in a font this tool cannot measure exactly, so it was kept as it is, even where it lies outside the crop area.`,
    );
  }
  if (report.formFieldsKept > 0) {
    kept.push(
      `${plural(report.formFieldsKept, "form field lies", "form fields lie")} outside the crop area. Form fields are kept so the form keeps working; their values stay in the file.`,
    );
  }
  const unread = report.streamsNotAnalysed + report.streamsPartlyAnalysed;
  if (unread > 0) {
    kept.push(
      `Some page content could not be read safely (${plural(unread, "part", "parts")}), so it was kept as it is.`,
    );
  }

  const notes: string[] = [];
  if (report.maxTextShift >= NOTABLE_TEXT_SHIFT) {
    notes.push(
      `Chrome's PDF viewer rounds letter widths, so where characters were removed from a line, the rest of that line may appear up to ${report.maxTextShift.toFixed(1)} pt from its place there. Other viewers show it exactly in place.`,
    );
  }
  return { summary, kept, notes };
}

/**
 * "1 page" / "3 pages".
 *
 * @param n How many.
 * @param one The singular phrase.
 * @param many The plural phrase.
 * @returns The count and phrase.
 */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
}

/**
 * "a", "a and b", "a, b and c".
 *
 * @param items Phrases.
 * @returns One phrase.
 */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
