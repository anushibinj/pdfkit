import { describe, expect, it } from "vitest";
import {
  MIN_OUTPUTS_FOR_PARTS,
  planAssemblyJobs,
  spanOf,
  type AssemblyJob,
} from "./assembly-jobs";

/** One output per page: what "split every 1 page" plans. */
const singles = (count: number) =>
  Array.from({ length: count }, (_, i) => [i]);

/**
 * Replay the jobs on paper: map every output back to source pages, so the
 * result can be compared with the plan. Also checks that each output is
 * produced exactly once and that part pages stay inside their part.
 */
function replay(jobs: AssemblyJob[], outputCount: number): number[][] {
  const result: (number[] | undefined)[] = Array(outputCount).fill(undefined);
  for (const job of jobs) {
    if (job.kind === "direct") {
      expect(result[job.outputIndex]).toBeUndefined();
      result[job.outputIndex] = job.pages;
      continue;
    }
    const partLength = job.span.last - job.span.first + 1;
    for (const out of job.outputs) {
      expect(result[out.outputIndex]).toBeUndefined();
      for (const p of out.pages) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(partLength);
      }
      result[out.outputIndex] = out.pages.map((p) => p + job.span.first);
    }
  }
  expect(result.every((r) => r !== undefined)).toBe(true);
  return result as number[][];
}

describe("planAssemblyJobs", () => {
  it("makes a few outputs directly", () => {
    const outputs = [[0, 1], [2], [3, 4]];
    expect(planAssemblyJobs(outputs, 5)).toEqual([
      { kind: "direct", outputIndex: 0, pages: [0, 1] },
      { kind: "direct", outputIndex: 1, pages: [2] },
      { kind: "direct", outputIndex: 2, pages: [3, 4] },
    ]);
    expect(planAssemblyJobs(singles(MIN_OUTPUTS_FOR_PARTS - 1), 7)).toHaveLength(
      MIN_OUTPUTS_FOR_PARTS - 1,
    );
  });

  it("groups many single-page outputs into parts of about √n", () => {
    const jobs = planAssemblyJobs(singles(100), 100);
    expect(jobs).toHaveLength(10);
    expect(jobs.every((j) => j.kind === "part")).toBe(true);
    expect(jobs[0]).toEqual({
      kind: "part",
      span: { first: 0, last: 9 },
      outputs: Array.from({ length: 10 }, (_, i) => ({
        outputIndex: i,
        pages: [i],
      })),
    });
    // pages are shifted to the part: page 95 is index 5 of the part 90-99
    expect(jobs[9]).toMatchObject({
      span: { first: 90, last: 99 },
      outputs: expect.arrayContaining([{ outputIndex: 95, pages: [5] }]),
    });
  });

  it("handles chunks with a short last file", () => {
    // every 3 pages of 31: ten files of 3 and one of 1
    const outputs = Array.from({ length: 11 }, (_, i) =>
      Array.from({ length: Math.min(3, 31 - i * 3) }, (_, k) => i * 3 + k),
    );
    const jobs = planAssemblyJobs(outputs, 31);
    expect(replay(jobs, outputs.length)).toEqual(outputs);
    // the last group (outputs 8-10, pages 24-30) is a part ending at page 30
    expect(jobs.at(-1)).toMatchObject({ kind: "part", span: { first: 24, last: 30 } });
  });

  it("makes a group directly when its stretch covers most of the file", () => {
    // typed ranges that jump from the start to the end of the file
    const outputs = Array.from({ length: 9 }, (_, i) => (i % 2 ? [99] : [0]));
    const jobs = planAssemblyJobs(outputs, 100);
    expect(jobs.every((j) => j.kind === "direct")).toBe(true);
    expect(replay(jobs, 9)).toEqual(outputs);
  });

  it("makes a group of one output directly", () => {
    // 13 outputs in groups of ⌈√13⌉ = 4: 0-3, 4-7, 8-11, and 12 alone
    const jobs = planAssemblyJobs(singles(13), 200);
    expect(jobs).toHaveLength(4);
    expect(jobs.at(-1)).toEqual({ kind: "direct", outputIndex: 12, pages: [12] });
  });

  it.each([
    ["single pages", singles(1000), 1000],
    ["pairs", Array.from({ length: 50 }, (_, i) => [2 * i, 2 * i + 1]), 100],
    [
      "overlapping ranges",
      Array.from({ length: 20 }, (_, i) => [i, i + 1, i + 2]),
      60,
    ],
    [
      "out of order",
      Array.from({ length: 12 }, (_, i) => [(i * 7) % 12]),
      12,
    ],
  ])("every output comes out exactly as planned (%s)", (_name, outputs, count) => {
    expect(replay(planAssemblyJobs(outputs, count), outputs.length)).toEqual(
      outputs,
    );
  });

  it("does not modify the plan it was given", () => {
    const outputs = singles(10);
    const copy = structuredClone(outputs);
    planAssemblyJobs(outputs, 10);
    expect(outputs).toEqual(copy);
  });
});

describe("spanOf", () => {
  it("finds the lowest and highest page of a group", () => {
    expect(spanOf([[5, 3], [9], [4]])).toEqual({ first: 3, last: 9 });
  });

  it("copes with very long page lists", () => {
    const many = Array.from({ length: 200_000 }, (_, i) => i);
    expect(spanOf([many])).toEqual({ first: 0, last: 199_999 });
  });
});
