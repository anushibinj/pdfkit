import type { PlannedOutput, ToolMode } from "./output-plan";
import { formatPageRuns, toPageRuns } from "./page-ranges";

/**
 * Characters Windows, macOS or common ZIP tools refuse or misread in file
 * names: path separators, the reserved `<>:"|?*`, and control characters.
 */
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/**
 * The part of the source file's name to build output names from.
 *
 * "Report 2024.pdf" gives "Report 2024". Unsafe characters become "_",
 * trailing dots and spaces are dropped (Windows strips them silently, which
 * could make two names collide), and an empty result falls back to
 * "document".
 *
 * @param sourceName The opened file's name.
 * @returns A safe base name without extension.
 */
export function baseName(sourceName: string): string {
  const base = sourceName
    .replace(/\.pdf$/i, "")
    .replace(UNSAFE, "_")
    .replace(/[. ]+$/, "")
    .trim();
  return base || "document";
}

/**
 * Describe an output's pages for its file name: "page-4" or "pages-1-3"
 * (1-based). Several runs are joined with "_" ("pages-1-3_5"), because
 * commas confuse some command-line tools.
 *
 * @param pages Source page indices of the output.
 * @returns The page part of the name.
 */
export function pagesLabel(pages: readonly number[]): string {
  const runs = toPageRuns(pages);
  const single = runs.length === 1 && runs[0].first === runs[0].last;
  return `${single ? "page" : "pages"}-${formatPageRuns(runs, "_")}`;
}

/**
 * Name every output file.
 *
 * - split: "<base>-pages-1-3.pdf", "<base>-page-4.pdf", ...
 * - extract: "<base>-extracted.pdf"
 * - remove: "<base>-pages-removed.pdf"
 *
 * Names are made unique, because typed ranges may repeat ("1-3, 1-3") and a
 * ZIP file, or a downloads folder, cannot hold two files with one name: the
 * second becomes "<name> (2).pdf", the third "<name> (3).pdf".
 *
 * @param sourceName The opened file's name.
 * @param mode The active mode.
 * @param outputs The planned files, in order.
 * @returns One unique name per output, in the same order.
 */
export function outputFileNames(
  sourceName: string,
  mode: ToolMode,
  outputs: readonly PlannedOutput[],
): string[] {
  const base = baseName(sourceName);
  const names = outputs.map(({ pages }) => {
    switch (mode) {
      case "extract":
        return `${base}-extracted`;
      case "remove":
        return `${base}-pages-removed`;
      case "split":
        return `${base}-${pagesLabel(pages)}`;
    }
  });
  return uniqueNames(names).map((name) => `${name}.pdf`);
}

/**
 * Add " (2)", " (3)", ... to repeated names, in order of appearance.
 *
 * A candidate is also checked against every name already handed out, so a
 * source that itself produces "a (2)" cannot collide with a renamed "a".
 *
 * @param names Names without extension.
 * @returns The names, each one unique.
 */
export function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    for (let n = 2; used.has(candidate); n++) candidate = `${name} (${n})`;
    used.add(candidate);
    return candidate;
  });
}

/**
 * The name of the ZIP file holding all split files.
 *
 * @param sourceName The opened file's name.
 * @returns "<base>-split.zip".
 */
export function zipFileName(sourceName: string): string {
  return `${baseName(sourceName)}-split.zip`;
}
