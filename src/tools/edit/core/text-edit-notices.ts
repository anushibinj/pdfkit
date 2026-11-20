import type { TextEdit, TextEditOutcome } from "./model";

/**
 * A short quote of a line for messages: the first 30 characters.
 *
 * @param text Any text.
 * @returns The quote.
 */
export function shortQuote(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed;
}

/**
 * Explain an edit's outcome to the user when it is not simply "done".
 *
 * - Not applied because the line was not found (the page changed under
 *   it), or because no font at hand can write any of the typed characters
 *   (the line is then left as it was).
 * - A standard font was used: the file's font for that line does not have
 *   all the typed characters, so the line looks different from its
 *   neighbours. Characters even that font cannot write are listed.
 *
 * @param edit What was asked for.
 * @param outcome What the engine did.
 * @returns A message, or `null` when there is nothing to say.
 */
export function describeTextOutcome(
  edit: TextEdit,
  outcome: TextEditOutcome,
): string | null {
  if (outcome.failure === "no-font") {
    return `Could not change the line to “${shortQuote(edit.text)}”: neither the PDF's font for it nor the standard fonts have these characters. The line was left as it was.`;
  }
  if (!outcome.applied) {
    return `Could not change “${shortQuote(edit.text)}”: that line was not found on the page.`;
  }
  if (!outcome.substituteFont) return null;
  const kept = new Set(outcome.written);
  const removed = [...new Set(edit.text)].filter(
    (c) => !kept.has(c) && c.trim() !== "",
  );
  const base = `“${shortQuote(outcome.written)}” is written in ${outcome.substituteFont}: the PDF's own font for that line lacks some of the characters you typed.`;
  return removed.length > 0
    ? `${base} Left out (no standard font has them): ${removed.join(" ")}`
    : base;
}
