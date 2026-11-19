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
   * Find out what PDFium would make of texts written in the fonts of some
   * fragments, without changing them: each text is written into a
   * temporary object in that fragment's font, read back through PDFium's
   * text extraction, and the temporary objects are removed again. Used to
   * catch characters a font would silently drop.
   *
   * @returns The extracted text per fragment index.
   */
  probe(
    requests: readonly { index: number; text: string }[],
  ): Map<number, string>;
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
 * and the outcome reports the text that was really written. If that leaves
 * nothing visible to write, the line is left exactly as it is instead:
 * writing would only erase it, which the user did not ask for (deleting is
 * done by emptying the line, handled before this is reached).
 *
 * @param surface The page.
 * @param run The line.
 * @param text The new text (not blank).
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
  if (written.trim() === "") {
    return {
      runId: run.id,
      applied: false,
      failure: "no-font",
      written: "",
      substituteFont: null,
    };
  }
  const [first, ...rest] = run.indices;
  surface.replace(first, fontName, written);
  rest.forEach((i) => surface.remove(i));
  return {
    runId: run.id,
    applied: true,
    failure: null,
    written,
    substituteFont: fontName,
  };
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
 * 2. Empty text deletes the line; unchanged text changes nothing.
 * 3. If the line's font demonstrably has every new character
 *    (`originalFontCanWrite`), the line becomes a candidate for keeping
 *    its font. Otherwise the standard font replaces it straight away.
 *
 * Candidates are then checked with `TextSurface.probe`: the new text is
 * written in the line's font into a temporary object and read back through
 * PDFium's text extraction. A font can lack a glyph even when step 3
 * passed (for instance a character the page only ever drew as part of a
 * ligature); PDFium then silently writes nothing for it, and the read-back
 * text differs. Only after that check is the line itself touched:
 * - same text: the first fragment gets the whole new text (keeping its
 *   font, size, spacing and place) and the other fragments are removed;
 * - different: the standard font replaces the line.
 * If even the standard font can write none of the text, the line is left
 * exactly as it was and the outcome says so. Checking before changing is
 * what makes that possible. All probes share one read-back because
 * building PDFium's text page is the costly part.
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
  const candidates: { run: TextRun; text: string }[] = [];
  const keptFont = (runId: string, written: string): TextEditOutcome => ({
    runId,
    applied: true,
    failure: null,
    written,
    substituteFont: null,
  });

  const latest = new Map(edits.map((e) => [e.runId, e.text]));
  for (const [runId, text] of latest) {
    const run = runs.get(runId);
    if (!run) {
      outcomes.set(runId, {
        runId,
        applied: false,
        failure: "line-not-found",
        written: "",
        substituteFont: null,
      });
    } else if (text.trim() === "") {
      run.indices.forEach((i) => surface.remove(i));
      outcomes.set(runId, keptFont(runId, ""));
    } else if (text === run.text) {
      outcomes.set(runId, keptFont(runId, text));
    } else {
      const first = fragments.get(run.indices[0])!;
      const observed = snapshot.observed.get(first.fontKey) ?? new Set();
      if (originalFontCanWrite(text, first.font, observed, metrics)) {
        candidates.push({ run, text });
      } else {
        outcomes.set(runId, writeWithStandardFont(surface, run, text, metrics));
      }
    }
  }

  if (candidates.length > 0) {
    const probed = surface.probe(
      candidates.map(({ run, text }) => ({ index: run.indices[0], text })),
    );
    for (const { run, text } of candidates) {
      const [first, ...rest] = run.indices;
      if (sameGlyphs(probed.get(first) ?? "", text)) {
        surface.setText(first, text);
        rest.forEach((i) => surface.remove(i));
        outcomes.set(run.id, keptFont(run.id, text));
      } else {
        outcomes.set(
          run.id,
          writeWithStandardFont(surface, run, text, metrics),
        );
      }
    }
  }

  return [...latest.keys()].map((id) => outcomes.get(id)!);
}
