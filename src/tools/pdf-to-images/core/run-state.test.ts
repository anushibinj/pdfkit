import { describe, expect, it } from "vitest";
import {
  INITIAL_RUN_STATE,
  recordRepeats,
  runReducer,
  type OutputFile,
  type RunState,
} from "./run-state";

const file = (id: string, pages = [1]): OutputFile => ({
  id,
  blob: new Blob(["x"]),
  mimeType: "image/png",
  width: 1,
  height: 1,
  pages,
});

/** A run that has just started: images mode, three pages. */
const running = () =>
  runReducer(INITIAL_RUN_STATE, {
    type: "start",
    mode: "images",
    total: 3,
  }) as Extract<RunState, { kind: "running" }>;

describe("recordRepeats", () => {
  it("adds the page to the repeated files once, leaving others untouched", () => {
    const a = file("a");
    const b = file("b");
    const out = recordRepeats([a, b], ["a", "a", "zzz"], 4);
    expect(out[0].pages).toEqual([1, 4]);
    expect(out[1]).toBe(b);
    expect(recordRepeats(out, ["a"], 4)[0].pages).toEqual([1, 4]);
  });

  it("returns the same array when nothing repeats", () => {
    const files = [file("a")];
    expect(recordRepeats(files, [], 2)).toBe(files);
  });
});

describe("runReducer", () => {
  it("starts an empty run and ignores a second start", () => {
    const state = running();
    expect(state).toEqual({
      kind: "running",
      mode: "images",
      done: 0,
      total: 3,
      files: [],
      skipped: [],
      stopping: false,
    });
    expect(runReducer(state, { type: "start", mode: "pages", total: 9 })).toBe(
      state,
    );
  });

  it("counts pages and collects rendered files", () => {
    const state = runReducer(running(), {
      type: "page-rendered",
      file: file("page-0"),
    });
    expect(state).toMatchObject({ done: 1, files: [{ id: "page-0" }] });
  });

  it("merges image findings: new files, repeats and skipped images", () => {
    let state = runReducer(running(), {
      type: "images-found",
      findings: {
        page: 1,
        files: [file("k1")],
        repeats: [],
        skipped: [
          { key: "k2", page: 1, width: 9, height: 9, reason: "too large" },
        ],
      },
    });
    state = runReducer(state, {
      type: "images-found",
      findings: {
        page: 2,
        files: [file("k3", [2])],
        repeats: ["k1", "k2"],
        skipped: [],
      },
    });
    expect(state).toMatchObject({ done: 2 });
    if (state.kind !== "running") throw new Error("expected running");
    expect(state.files.map((f) => [f.id, f.pages])).toEqual([
      ["k1", [1, 2]],
      ["k3", [2]],
    ]);
    expect(state.skipped).toHaveLength(1);
  });

  it("records a stop request once, for the progress message", () => {
    const stopping = runReducer(running(), { type: "stop-requested" });
    expect(stopping).toMatchObject({ stopping: true });
    expect(runReducer(stopping, { type: "stop-requested" })).toBe(stopping);
  });

  it("finishes as stopped only when the run says pages were left", () => {
    const stopping = runReducer(running(), { type: "stop-requested" });
    expect(runReducer(stopping, { type: "finish", stopped: true })).toEqual({
      kind: "finished",
      mode: "images",
      files: [],
      skipped: [],
      stopped: true,
    });
    // Stop pressed during the last page: every page was processed.
    expect(
      runReducer(stopping, { type: "finish", stopped: false }),
    ).toMatchObject({ stopped: false });
  });

  it("fails keeping the files produced so far", () => {
    const state = runReducer(running(), {
      type: "page-rendered",
      file: file("p"),
    });
    expect(
      runReducer(state, { type: "fail", message: "out of memory" }),
    ).toMatchObject({
      kind: "failed",
      files: [{ id: "p" }],
      message: "out of memory",
    });
  });

  it("ignores progress when not running, and resets to idle", () => {
    const idle = INITIAL_RUN_STATE;
    expect(runReducer(idle, { type: "page-rendered", file: file("x") })).toBe(
      idle,
    );
    expect(runReducer(idle, { type: "finish", stopped: false })).toBe(idle);
    expect(runReducer(idle, { type: "reset" })).toBe(idle);
    const finished = runReducer(running(), { type: "finish", stopped: false });
    expect(runReducer(finished, { type: "fail", message: "late" })).toBe(
      finished,
    );
    expect(runReducer(finished, { type: "reset" })).toBe(INITIAL_RUN_STATE);
    // a finished run can start again
    expect(
      runReducer(finished, { type: "start", mode: "pages", total: 1 }),
    ).toMatchObject({
      kind: "running",
      mode: "pages",
    });
  });
});
