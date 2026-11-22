import type { PageRenderOptions } from "./core/options";
import type {
  ConversionMode,
  OutputFile,
  PageImageFindings,
} from "./core/run-state";
import type {
  ExtractImagesResult,
  RenderPageResult,
  WireImageEntry,
} from "./messages";

/** What a run needs from `ImagesEngine`. */
export interface ConversionEngine {
  renderPage(
    pageIndex: number,
    options: PageRenderOptions,
  ): Promise<RenderPageResult>;
  extractImages(
    pageIndex: number,
    knownKeys: readonly string[],
  ): Promise<ExtractImagesResult>;
}

/** Where a run reports its progress. */
export interface RunHandlers {
  /** A page was rendered (pages mode). */
  onPage(file: OutputFile): void;
  /** A page was searched for images (images mode). */
  onImages(findings: PageImageFindings): void;
  /** Asked before each page; `true` ends the run there. */
  shouldStop(): boolean;
}

/**
 * How a run ended. `stopped` is true only when a stop request ended it
 * with pages left; a stop pressed during the last page changes nothing.
 */
export type RunOutcome =
  { ok: true; stopped: boolean } | { ok: false; message: string };

/**
 * Turn a rendered page into an output file.
 *
 * @param result The worker's answer.
 * @returns The file, with id "page-<index>".
 */
export function pageFile(
  result: Extract<RenderPageResult, { status: "page" }>,
): OutputFile {
  return {
    id: `page-${result.pageIndex}`,
    blob: new Blob([result.data], { type: result.mimeType }),
    mimeType: result.mimeType,
    width: result.width,
    height: result.height,
    pages: [result.pageIndex + 1],
    dpi: result.dpi,
    reduced: result.reduced,
  };
}

/**
 * Sort one page's image entries into new files, repeats and skipped images.
 *
 * @param pageIndex Zero-based page index.
 * @param entries The worker's entries for the page.
 * @returns The findings, with 1-based page numbers.
 */
export function imageFindings(
  pageIndex: number,
  entries: readonly WireImageEntry[],
): PageImageFindings {
  const page = pageIndex + 1;
  const findings: PageImageFindings = {
    page,
    files: [],
    repeats: [],
    skipped: [],
  };
  for (const entry of entries) {
    switch (entry.kind) {
      case "image":
        findings.files.push({
          id: entry.key,
          blob: new Blob([entry.data], { type: entry.mimeType }),
          mimeType: entry.mimeType,
          width: entry.width,
          height: entry.height,
          pages: [page],
          method: entry.method,
        });
        break;
      case "repeat":
        findings.repeats.push(entry.key);
        break;
      case "skipped":
        findings.skipped.push({
          key: entry.key,
          page,
          width: entry.width,
          height: entry.height,
          reason: entry.reason,
        });
        break;
    }
  }
  return findings;
}

/**
 * Run a conversion over the selected pages, one page at a time.
 *
 * Pages go one by one so results appear as they are ready, memory holds
 * one page's work at a time, and a stop request takes effect at the next
 * page. In images mode the keys of every image met so far (extracted or
 * skipped) are sent with each page, so an image repeated on later pages is
 * neither decoded nor reported twice. The first failure ends the run; what
 * was produced before it stays valid.
 *
 * @param engine The worker client.
 * @param mode Render pages, or extract images.
 * @param pages Zero-based indices, in order.
 * @param options Render options (pages mode).
 * @param handlers Progress callbacks and the stop check.
 * @returns Whether the run completed, was stopped with pages left, or
 *   failed, and why.
 */
export async function runConversion(
  engine: ConversionEngine,
  mode: ConversionMode,
  pages: readonly number[],
  options: PageRenderOptions,
  handlers: RunHandlers,
): Promise<RunOutcome> {
  const known = new Set<string>();
  for (const pageIndex of pages) {
    if (handlers.shouldStop()) return { ok: true, stopped: true };
    if (mode === "pages") {
      const result = await engine.renderPage(pageIndex, options);
      if (result.status === "error") {
        return {
          ok: false,
          message: `Page ${pageIndex + 1}: ${result.message}`,
        };
      }
      handlers.onPage(pageFile(result));
    } else {
      const result = await engine.extractImages(pageIndex, [...known]);
      if (result.status === "error") {
        return {
          ok: false,
          message: `Page ${pageIndex + 1}: ${result.message}`,
        };
      }
      const findings = imageFindings(pageIndex, result.entries);
      for (const file of findings.files) known.add(file.id);
      for (const skipped of findings.skipped) known.add(skipped.key);
      handlers.onImages(findings);
    }
  }
  return { ok: true, stopped: false };
}
