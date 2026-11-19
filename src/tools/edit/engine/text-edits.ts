import type { TextEdit, TextEditOutcome } from "../core/model";
import { stripUnsupported, type FontMetricsSource } from "../core/text-layout";
import {
  groupFragments,
  originalFontCanWrite,
  standardFontFor,
  type PageTextSnapshot,
  type TextFragment,
  type TextRun,
} from "../core/text-runs";

/**
 * The operations {@link applyTextEdits} needs on one loaded page.
 *
 * Fragments are addressed by their object index as read in
 * {@link TextSurface.read}; the implementation keeps track of the objects
 * themselves, so indices stay valid while objects are removed or replaced.
 * `PdfiumPageText` implements it with PDFium; tests use an in-memory fake.
 */
export interface TextSurface {
  /** @returns The page's text as it was before any change. */
  read(): PageTextSnapshot;
  /**
   * Give a text object new text, keeping its font, size, position and
   * colour.
   */
  setText(index: number, text: string): void;
  /**
   * Swap a text object for a new one in a standard font, at the same place
   * in the content order, with the same matrix, size and colours.
   */
  replace(index: number, fontName: string, text: string): void;
  /** Delete a text object from the page. */
  remove(index: number): void;
  /**
   * Read the text of objects as PDFium now understands them, after
   * changes. Used to catch characters a font silently dropped.
   */
  readBack(indices: readonly number[]): Map<number, string>;
}

/**
 * Compare texts ignoring whitespace. PDFium's text extraction adds or drops
 * spaces at object edges, which says nothing about missing glyphs.
 *
 * @param a A text.
 * @param b Another text.
 * @returns `true` if both have the same non-space characters in order.
 */
export function sameGlyphs(a: string, b: string): boolean {
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

/**
 * Write a line in the closest standard font, replacing its first fragment
 * and deleting the others.
 *
 * Characters the standard font cannot encode (outside WinAnsi) are left out
 * and the outcome reports the text that was really written.
 *
 * @param surface The page.
 * @param run The line.
 * @param text The new text.
 * @param metrics Standard font metrics.
 * @returns The outcome.
 */
function writeWithStandardFont(
  surface: TextSurface,
  run: TextRun,
  text: string,
  metrics: FontMetricsSource,
): TextEditOutcome {
  const fontName = standardFontFor(run.style);
  const written = stripUnsupported(text, run.style.family, metrics).text;
  const [first, ...rest] = run.indices;
  if (written.trim() === "") {
    run.indices.forEach((i) => surface.remove(i));
  } else {
    surface.replace(first, fontName, written);
    rest.forEach((i) => surface.remove(i));
  }
  return { runId: run.id, applied: true, written, substituteFont: fontName };
}

/**
 * Change the text of existing lines on a page, in place.
 *
 * The line keeps its own font whenever that is safe, and otherwise gets
 * the closest standard font at exactly the same position, size and colour.
 * Nothing is painted over the old text: the old text objects are changed or
 * removed, so the result reads, searches and copies as the new text.
 *
 * For each edit:
 * 1. Find the line by id. Ids are the object indices of the line's
 *    fragments, so an id from an older reading of a different page simply
 *    does not match and the edit is reported as not applied.
 * 2. Empty text deletes the line.
 * 3. If the line's font demonstrably has every new character
 *    (`originalFontCanWrite`), the first fragment gets the whole new text
 *    and the other fragments are removed. The line still starts where it
 *    did, in the same font.
 * 4. Otherwise the standard font replaces it straight away.
 *
 * Then every line edited in its own font is read back through PDFium's text
 * extraction. A font can lack a glyph even when the check in step 3 passed
 * (for instance a character the page only ever drew as part of a
 * ligature); PDFium then silently writes nothing for it. If the read-back
 * text differs, that line is redone in the standard font. All read-backs
 * happen in one pass because building PDFium's text page is the costly
 * part.
 *
 * @param surface The loaded page.
 * @param edits The new texts by line id (already sanitised). If an id
 *   repeats, its last text wins, so a line is never changed twice.
 * @param metrics Standard font metrics, for the fallback.
 * @returns One outcome per distinct line id, in order of first appearance.
 */
export function applyTextEdits(
  surface: TextSurface,
  edits: readonly TextEdit[],
  metrics: FontMetricsSource,
): TextEditOutcome[] {
  if (edits.length === 0) return [];
  const snapshot = surface.read();
  const fragments = new Map<number, TextFragment>(
    snapshot.fragments.map((f) => [f.index, f]),
  );
  const runs = new Map(
    groupFragments(snapshot.fragments).map((r) => [r.id, r]),
  );
  const outcomes = new Map<string, TextEditOutcome>();
  const toVerify: { run: TextRun; text: string }[] = [];

  const latest = new Map(edits.map((e) => [e.runId, e.text]));
  for (const [runId, text] of latest) {
    const run = runs.get(runId);
    if (!run) {
      outcomes.set(runId, {
        runId,
        applied: false,
        written: "",
        substituteFont: null,
      });
      continue;
    }
    if (text.trim() === "") {
      run.indices.forEach((i) => surface.remove(i));
      outcomes.set(runId, {
        runId,
        applied: true,
        written: "",
        substituteFont: null,
      });
      continue;
    }
    const first = fragments.get(run.indices[0])!;
    const observed = snapshot.observed.get(first.fontKey) ?? new Set<string>();
    if (originalFontCanWrite(text, first.font, observed, metrics)) {
      surface.setText(first.index, text);
      run.indices.slice(1).forEach((i) => surface.remove(i));
      toVerify.push({ run, text });
      outcomes.set(runId, {
        runId,
        applied: true,
        written: text,
        substituteFont: null,
      });
    } else {
      outcomes.set(runId, writeWithStandardFont(surface, run, text, metrics));
    }
  }

  if (toVerify.length > 0) {
    const readBack = surface.readBack(toVerify.map((v) => v.run.indices[0]));
    for (const { run, text } of toVerify) {
      if (!sameGlyphs(readBack.get(run.indices[0]) ?? "", text)) {
        // Only the first fragment is left: the others were removed above.
        outcomes.set(
          run.id,
          writeWithStandardFont(
            surface,
            { ...run, indices: [run.indices[0]] },
            text,
            metrics,
          ),
        );
      }
    }
  }

  return [...latest.keys()].map((id) => outcomes.get(id)!);
}
