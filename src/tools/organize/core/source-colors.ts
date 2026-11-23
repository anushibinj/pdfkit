/**
 * Colours that tell the opened files apart on the board.
 *
 * Colour is never the only cue (WCAG 1.4.1): every page also shows its
 * file's number, and its accessible name includes the file name.
 *
 * The class names are written out in full because Tailwind generates only
 * the classes it finds verbatim in the source.
 */

/** Tailwind classes for one file's colour. */
export interface SourceColor {
  /** Human name, e.g. for tests and debugging. */
  name: string;
  /** Solid fill for the file's number chip and the page's top bar. */
  fill: string;
  /** Text colour that reads on `fill`. */
  onFill: string;
}

/** Eight colours that stay distinct in light and dark themes. */
export const SOURCE_COLORS: readonly SourceColor[] = [
  { name: "blue", fill: "bg-sky-600", onFill: "text-white" },
  { name: "amber", fill: "bg-amber-400", onFill: "text-amber-950" },
  { name: "green", fill: "bg-emerald-600", onFill: "text-white" },
  { name: "rose", fill: "bg-rose-600", onFill: "text-white" },
  { name: "violet", fill: "bg-violet-600", onFill: "text-white" },
  { name: "teal", fill: "bg-teal-400", onFill: "text-teal-950" },
  { name: "orange", fill: "bg-orange-600", onFill: "text-white" },
  { name: "fuchsia", fill: "bg-fuchsia-600", onFill: "text-white" },
];

/**
 * The colour of the file in palette slot `index`. Slots wrap around after
 * {@link SOURCE_COLORS}.length files; the file numbers stay unique.
 *
 * @param index The file's palette slot (0-based; negative counts as 0).
 * @returns Its colour.
 */
export function sourceColor(index: number): SourceColor {
  const n = SOURCE_COLORS.length;
  const slot = Number.isInteger(index) && index > 0 ? index % n : 0;
  return SOURCE_COLORS[slot];
}
