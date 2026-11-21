import { suffixedPdfName } from "@/lib/format";
import type { BoardPage, BoardSource } from "./board";

/** Download name when the pages come from more than one file. */
export const COMBINED_FILE_NAME = "organized.pdf";

/**
 * Name the organized file.
 *
 * When every page on the board comes from one file (blank pages aside),
 * the result is a re-arranged version of that file: "report.pdf" becomes
 * "report-organized.pdf". Pages from several files make a new document,
 * named {@link COMBINED_FILE_NAME}.
 *
 * @param pages The board pages.
 * @param sources The opened files.
 * @returns The suggested download name.
 */
export function outputFileName(
  pages: readonly BoardPage[],
  sources: readonly BoardSource[],
): string {
  const used = new Set<string>();
  for (const page of pages) if (page.kind === "source") used.add(page.sourceId);
  if (used.size !== 1) return COMBINED_FILE_NAME;
  const [id] = used;
  const source = sources.find((s) => s.id === id);
  return source
    ? suffixedPdfName(source.name, "-organized")
    : COMBINED_FILE_NAME;
}
