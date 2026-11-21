import type { PageRun } from "@/lib/page-ranges";

/**
 * Turning a list of planned output files into qpdf runs, fast.
 *
 * Every output file is made by one qpdf command,
 * `qpdf <input> --pages . <pages> -- <output>`, which keeps the source's
 * password, document information and the form fields of the kept pages.
 * The catch is speed: one such run has to read the *input's* page tree, so
 * its time grows with the input's page count, not with the output's.
 * Measured with this qpdf build (one page out of a file of N pages):
 *
 *     N = 1: 4.6 ms     N = 300: 79 ms     N = 1000: 330 ms
 *
 * Splitting a 1000-page file into single pages directly is 1000 runs over
 * 1000 pages each: about 5 minutes. That is what this module avoids.
 *
 * The idea: first copy a short stretch of the source into a temporary
 * "part" (one run over the big file), then make the outputs of that stretch
 * from the part (cheap runs over a small file). With n outputs taken in
 * groups of k, the work is about
 *
 *     n/k runs over the whole file  +  n runs over parts of ~k·N/n pages
 *
 * which is smallest when k ≈ √n. For 1000 single-page outputs that is
 * 32 groups of 32: 32 runs over 1000 pages plus 1000 runs over 32 pages.
 * Measured with this qpdf build in Node: 19 s instead of ~310 s for 1000
 * pages, 3.1 s instead of ~31 s for 300. The files are identical (the part
 * is made by the same qpdf command, so it keeps everything an output made
 * from the source would keep).
 *
 * A part only helps when its stretch is clearly shorter than the source.
 * Typed ranges can be in any order ("90-100, 1-5"), so a group's stretch
 * may cover most of the file; such groups are made directly instead.
 */

/** Make one output straight from the source file. */
export interface DirectJob {
  kind: "direct";
  /** Position of the output in the plan; results are returned in that order. */
  outputIndex: number;
  /** Source page indices (0-based), in output order. */
  pages: number[];
}

/**
 * Copy a stretch of the source into a temporary part, then make several
 * outputs from that part.
 */
export interface PartJob {
  kind: "part";
  /** The source pages copied into the part: `first` to `last`, in order. */
  span: PageRun;
  outputs: {
    /** Position of the output in the plan. */
    outputIndex: number;
    /** Page indices *within the part* (source index minus `span.first`). */
    pages: number[];
  }[];
}

export type AssemblyJob = DirectJob | PartJob;

/**
 * Below this many outputs, every output is made directly: a handful of
 * runs over the source is fast, and parts would only add runs.
 */
export const MIN_OUTPUTS_FOR_PARTS = 8;

/**
 * Plan the qpdf runs for a list of outputs.
 *
 * Step by step:
 * 1. With fewer than {@link MIN_OUTPUTS_FOR_PARTS} outputs, make each one
 *    directly.
 * 2. Otherwise cut the list, in order, into groups of ⌈√n⌉ outputs (see
 *    the module comment for why √n).
 * 3. For each group, find the stretch of source pages it uses (lowest to
 *    highest page). If the group has at least two outputs and the stretch
 *    is at most half the document, plan a part for the stretch and make
 *    the group's outputs from it, with page indices shifted so that the
 *    stretch's first page is index 0 of the part. Otherwise make the
 *    group's outputs directly.
 *
 * Every output appears in exactly one job, and outputs keep their index,
 * so the caller can put results back in plan order whatever the job order.
 *
 * @param outputs Source page indices per output (each non-empty).
 * @param pageCount Pages in the source.
 * @returns The jobs, in an order that keeps at most one part alive at a time.
 */
export function planAssemblyJobs(
  outputs: readonly (readonly number[])[],
  pageCount: number,
): AssemblyJob[] {
  const direct = (pages: readonly number[], outputIndex: number): DirectJob => ({
    kind: "direct",
    outputIndex,
    pages: [...pages],
  });
  if (outputs.length < MIN_OUTPUTS_FOR_PARTS) return outputs.map(direct);

  const groupSize = Math.ceil(Math.sqrt(outputs.length));
  const jobs: AssemblyJob[] = [];
  for (let start = 0; start < outputs.length; start += groupSize) {
    const group = outputs.slice(start, start + groupSize);
    const span = spanOf(group);
    const spanLength = span.last - span.first + 1;
    if (group.length < 2 || spanLength * 2 > pageCount) {
      group.forEach((pages, i) => jobs.push(direct(pages, start + i)));
      continue;
    }
    jobs.push({
      kind: "part",
      span,
      outputs: group.map((pages, i) => ({
        outputIndex: start + i,
        pages: pages.map((page) => page - span.first),
      })),
    });
  }
  return jobs;
}

/**
 * The stretch of pages a group of outputs uses.
 *
 * A plain loop instead of `Math.min(...pages)`: spreading a 10,000-page
 * array into function arguments can exceed the engine's argument limit.
 *
 * @param group The outputs' source page indices (each non-empty).
 * @returns The lowest and highest page used.
 */
export function spanOf(group: readonly (readonly number[])[]): PageRun {
  let first = Infinity;
  let last = -Infinity;
  for (const pages of group) {
    for (const page of pages) {
      if (page < first) first = page;
      if (page > last) last = page;
    }
  }
  return { first, last };
}
