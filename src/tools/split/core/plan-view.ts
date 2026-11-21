import type { PlanResult, PlannedOutput, ToolMode } from "./output-plan";

/**
 * For each page, the files it goes into, as 1-based file numbers.
 *
 * Shown under each thumbnail in split mode ("File 2"). Typed ranges may
 * overlap, so one page can be in several files, or in none at all.
 *
 * @param outputs The planned files, in order.
 * @param pageCount Pages in the document.
 * @returns One list per page (empty for pages in no file).
 */
export function filesPerPage(
  outputs: readonly PlannedOutput[],
  pageCount: number,
): number[][] {
  const files: number[][] = Array.from({ length: pageCount }, () => []);
  outputs.forEach(({ pages }, i) => {
    for (const page of pages) {
      const list = files[page];
      // A page listed twice in one file (typed "1-3, 2") counts once.
      if (list && list.at(-1) !== i + 1) list.push(i + 1);
    }
  });
  return files;
}

/**
 * Describe a page's files for its thumbnail: "File 2", "Files 1, 3", or
 * "Not in any file".
 *
 * @param files 1-based file numbers.
 * @returns The label.
 */
export function filesLabel(files: readonly number[]): string {
  if (files.length === 0) return "Not in any file";
  return `${files.length === 1 ? "File" : "Files"} ${files.join(", ")}`;
}

/**
 * A key identifying a plan: the same settings give the same key.
 *
 * Built files are stored with the key of the plan that made them, and shown
 * only while the current plan has the same key. Changing any setting
 * therefore hides results that no longer match, without an effect or an
 * explicit reset.
 *
 * @param mode The active mode (extract and remove can plan the same pages).
 * @param outputs The planned files.
 * @returns The key.
 */
export function planKey(mode: ToolMode, outputs: readonly PlannedOutput[]): string {
  return `${mode}:${outputs.map((o) => o.pages.join(",")).join("|")}`;
}

/**
 * The main button's text: what pressing it will do.
 *
 * With a valid plan it says how much ("Split into 4 files", "Extract 3
 * pages", "Remove 1 page"); without one it names the action only, since
 * the button is disabled and the reason is shown next to it.
 *
 * @param mode The active mode.
 * @param plan The current plan.
 * @param pageCount Pages in the document (to count removed pages).
 * @returns The label.
 */
export function actionLabel(mode: ToolMode, plan: PlanResult, pageCount: number): string {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (!plan.ok) {
    return mode === "split" ? "Split PDF" : mode === "extract" ? "Extract pages" : "Remove pages";
  }
  switch (mode) {
    case "split":
      return `Split into ${count(plan.outputs.length, "file")}`;
    case "extract":
      return `Extract ${count(plan.outputs[0].pages.length, "page")}`;
    case "remove":
      return `Remove ${count(pageCount - plan.outputs[0].pages.length, "page")}`;
  }
}
