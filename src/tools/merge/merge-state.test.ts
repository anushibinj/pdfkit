import { describe, expect, it } from "vitest";
import {
  INITIAL_MERGE_STATE,
  mergeReducer,
  mergeSummary,
  nextToCheck,
  statusFromInspection,
  type FileStatus,
  type MergeAction,
  type MergeItem,
  type MergeState,
} from "./merge-state";

const file = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

const item = (id: string, status: FileStatus, size = 10): MergeItem => ({
  id,
  file: file(`${id}.pdf`, size),
  status,
});

const ready = (pageCount: number, password?: string): FileStatus => ({
  kind: "ready",
  pageCount,
  password,
});

const state = (
  items: MergeItem[],
  outcome: MergeState["outcome"] = { kind: "idle" },
): MergeState => ({ items, outcome });

const run = (s: MergeState, ...actions: MergeAction[]) =>
  actions.reduce(mergeReducer, s);

const pdf = new Blob(["%PDF"], { type: "application/pdf" });
const ids = (s: MergeState) => s.items.map((i) => i.id);

describe("mergeSummary", () => {
  it("adds up pages of ready files and every file's size", () => {
    const summary = mergeSummary([
      item("a", ready(2), 100),
      item("b", ready(3), 50),
    ]);
    expect(summary).toEqual({
      fileCount: 2,
      pageCount: 5,
      totalBytes: 150,
      blocker: undefined,
    });
  });

  it("needs at least two files", () => {
    expect(mergeSummary([]).blocker).toBe("too-few");
    expect(mergeSummary([item("a", ready(1))]).blocker).toBe("too-few");
  });

  it("names blockers in the order a user would fix them", () => {
    const locked: FileStatus = {
      kind: "needs-password",
      wrong: false,
      dismissed: false,
    };
    const broken: FileStatus = {
      kind: "error",
      reason: "failed",
      message: "x",
    };
    expect(
      mergeSummary([item("a", { kind: "queued" }), item("b", locked)]).blocker,
    ).toBe("checking");
    expect(
      mergeSummary([item("a", { kind: "checking" }), item("b", broken)])
        .blocker,
    ).toBe("checking");
    expect(mergeSummary([item("a", broken), item("b", locked)]).blocker).toBe(
      "locked",
    );
    expect(mergeSummary([item("a", ready(1)), item("b", broken)]).blocker).toBe(
      "unreadable",
    );
  });
});

describe("nextToCheck", () => {
  it("returns the first queued file", () => {
    const items = [
      item("a", ready(1)),
      item("b", { kind: "queued", password: "pw" }),
      item("c", { kind: "queued" }),
    ];
    expect(nextToCheck(items)?.id).toBe("b");
  });

  it("waits while a file is being checked", () => {
    expect(
      nextToCheck([
        item("a", { kind: "checking" }),
        item("b", { kind: "queued" }),
      ]),
    ).toBeUndefined();
  });

  it("returns nothing when no file waits", () => {
    expect(nextToCheck([item("a", ready(1))])).toBeUndefined();
  });
});

describe("statusFromInspection", () => {
  it("keeps the password that opened the file", () => {
    expect(
      statusFromInspection({ status: "inspected", pageCount: 4 }, "pw"),
    ).toEqual(ready(4, "pw"));
  });

  it("maps password problems and errors", () => {
    expect(
      statusFromInspection({ status: "password-required" }, undefined),
    ).toEqual({ kind: "needs-password", wrong: false, dismissed: false });
    expect(statusFromInspection({ status: "wrong-password" }, "x")).toEqual({
      kind: "needs-password",
      wrong: true,
      dismissed: false,
    });
    expect(
      statusFromInspection(
        { status: "error", reason: "out-of-memory", message: "m" },
        undefined,
      ),
    ).toEqual({ kind: "error", reason: "out-of-memory", message: "m" });
  });

  it("keeps a skipped prompt skipped", () => {
    expect(
      statusFromInspection({ status: "wrong-password" }, "x", true),
    ).toEqual({ kind: "needs-password", wrong: true, dismissed: true });
    expect(
      statusFromInspection({ status: "password-required" }, undefined, true),
    ).toEqual({ kind: "needs-password", wrong: false, dismissed: true });
  });
});

describe("mergeReducer: the list", () => {
  it("appends added files as queued, in order", () => {
    const s = run(
      INITIAL_MERGE_STATE,
      { type: "add", items: [{ id: "a", file: file("a.pdf") }] },
      { type: "add", items: [{ id: "b", file: file("b.pdf") }] },
    );
    expect(ids(s)).toEqual(["a", "b"]);
    expect(s.items[1].status).toEqual({ kind: "queued" });
  });

  it("ignores adding nothing", () => {
    expect(mergeReducer(INITIAL_MERGE_STATE, { type: "add", items: [] })).toBe(
      INITIAL_MERGE_STATE,
    );
  });

  it("checks a queued file and records the result with its password", () => {
    const s = run(
      state([item("a", { kind: "queued", password: "pw" })]),
      { type: "check-started", id: "a" },
      {
        type: "checked",
        id: "a",
        result: { status: "inspected", pageCount: 2 },
      },
    );
    expect(s.items[0].status).toEqual(ready(2, "pw"));
  });

  it("ignores a result for a file that is no longer being checked", () => {
    const s = state([item("a", ready(1))]);
    expect(
      mergeReducer(s, {
        type: "checked",
        id: "a",
        result: { status: "wrong-password" },
      }),
    ).toBe(s);
    expect(
      mergeReducer(s, {
        type: "checked",
        id: "gone",
        result: { status: "wrong-password" },
      }),
    ).toBe(s);
  });

  it("re-queues a locked file with the typed password", () => {
    const s = run(
      state([
        item("a", { kind: "needs-password", wrong: true, dismissed: false }),
      ]),
      { type: "submit-password", id: "a", password: "hunter2" },
    );
    expect(s.items[0].status).toEqual({ kind: "queued", password: "hunter2" });
  });

  it("only takes passwords for locked files", () => {
    const s = state([item("a", ready(1))]);
    expect(
      mergeReducer(s, { type: "submit-password", id: "a", password: "x" }),
    ).toBe(s);
  });

  it("skips and reopens the password prompt", () => {
    const locked = state([
      item("a", { kind: "needs-password", wrong: false, dismissed: false }),
    ]);
    const skipped = mergeReducer(locked, { type: "dismiss-password", id: "a" });
    expect(skipped.items[0].status).toMatchObject({ dismissed: true });
    expect(mergeReducer(skipped, { type: "dismiss-password", id: "a" })).toBe(
      skipped,
    );
    const reopened = mergeReducer(skipped, {
      type: "reopen-password",
      id: "a",
    });
    expect(reopened.items[0].status).toMatchObject({ dismissed: false });
    expect(mergeReducer(reopened, { type: "reopen-password", id: "a" })).toBe(
      reopened,
    );
  });

  it("remembers a prompt closed while its password is checked", () => {
    const checking = run(
      state([
        item("a", { kind: "needs-password", wrong: false, dismissed: false }),
      ]),
      { type: "submit-password", id: "a", password: "nope" },
      { type: "check-started", id: "a" },
      { type: "dismiss-password", id: "a" },
    );
    expect(checking.items[0].status).toEqual({
      kind: "checking",
      password: "nope",
      promptSkipped: true,
    });
    expect(mergeReducer(checking, { type: "dismiss-password", id: "a" })).toBe(
      checking,
    );
    // A wrong password then waits behind "Enter password" instead of
    // reopening the prompt the user just closed.
    const answered = mergeReducer(checking, {
      type: "checked",
      id: "a",
      result: { status: "wrong-password" },
    });
    expect(answered.items[0].status).toEqual({
      kind: "needs-password",
      wrong: true,
      dismissed: true,
    });
  });

  it("ignores closing the prompt of a file checked without a password", () => {
    const s = state([item("a", { kind: "checking" })]);
    expect(mergeReducer(s, { type: "dismiss-password", id: "a" })).toBe(s);
  });

  it("moves files up and down, and not past either end", () => {
    const s = state([
      item("a", ready(1)),
      item("b", ready(1)),
      item("c", ready(1)),
    ]);
    expect(ids(mergeReducer(s, { type: "move", id: "c", offset: -1 }))).toEqual(
      ["a", "c", "b"],
    );
    expect(ids(mergeReducer(s, { type: "move", id: "a", offset: 1 }))).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(mergeReducer(s, { type: "move", id: "a", offset: -1 })).toBe(s);
    expect(mergeReducer(s, { type: "move", id: "c", offset: 1 })).toBe(s);
    expect(mergeReducer(s, { type: "move", id: "zz", offset: 1 })).toBe(s);
  });

  it("removes one file, or all of them", () => {
    const s = state([item("a", ready(1)), item("b", ready(1))]);
    expect(ids(mergeReducer(s, { type: "remove", id: "a" }))).toEqual(["b"]);
    expect(mergeReducer(s, { type: "remove", id: "zz" })).toBe(s);
    expect(mergeReducer(s, { type: "clear" })).toEqual(INITIAL_MERGE_STATE);
    expect(mergeReducer(INITIAL_MERGE_STATE, { type: "clear" })).toBe(
      INITIAL_MERGE_STATE,
    );
  });
});

describe("mergeReducer: merging", () => {
  const twoReady = () => state([item("a", ready(2)), item("b", ready(3))]);

  it("starts, then finishes with the total page count", () => {
    const merging = mergeReducer(twoReady(), { type: "merge-started" });
    expect(merging.outcome).toEqual({ kind: "merging" });
    const done = mergeReducer(merging, {
      type: "merge-succeeded",
      pdf,
      warnings: "w",
    });
    expect(done.outcome).toEqual({
      kind: "done",
      pdf,
      pageCount: 5,
      warnings: "w",
    });
  });

  it("records a failure", () => {
    const s = run(
      twoReady(),
      { type: "merge-started" },
      {
        type: "merge-failed",
        reason: "out-of-memory",
        message: "m",
      },
    );
    expect(s.outcome).toEqual({
      kind: "error",
      reason: "out-of-memory",
      message: "m",
    });
  });

  it("refuses to start while something blocks it, or twice", () => {
    const blocked = state([item("a", ready(1))]);
    expect(mergeReducer(blocked, { type: "merge-started" })).toBe(blocked);
    const merging = mergeReducer(twoReady(), { type: "merge-started" });
    expect(mergeReducer(merging, { type: "merge-started" })).toBe(merging);
  });

  it("ignores results when no merge is running", () => {
    const s = twoReady();
    expect(mergeReducer(s, { type: "merge-succeeded", pdf })).toBe(s);
    expect(
      mergeReducer(s, { type: "merge-failed", reason: "failed", message: "x" }),
    ).toBe(s);
  });

  it("locks the list while merging", () => {
    const merging = mergeReducer(twoReady(), { type: "merge-started" });
    const locking: MergeAction[] = [
      { type: "add", items: [{ id: "c", file: file("c.pdf") }] },
      { type: "move", id: "b", offset: -1 },
      { type: "remove", id: "a" },
      { type: "clear" },
    ];
    for (const action of locking) {
      expect(mergeReducer(merging, action)).toBe(merging);
    }
  });

  it("drops a finished PDF whenever what would be merged changes", () => {
    const done = run(
      twoReady(),
      { type: "merge-started" },
      {
        type: "merge-succeeded",
        pdf,
      },
    );
    const changes: MergeAction[] = [
      { type: "add", items: [{ id: "c", file: file("c.pdf") }] },
      { type: "move", id: "b", offset: -1 },
      { type: "remove", id: "a" },
    ];
    for (const action of changes) {
      expect(mergeReducer(done, action).outcome).toEqual({ kind: "idle" });
    }
  });

  it("drops a merge error when a password is typed", () => {
    const s = state(
      [
        item("a", ready(1)),
        item("b", { kind: "needs-password", wrong: false, dismissed: false }),
      ],
      { kind: "error", reason: "failed", message: "x" },
    );
    const next = mergeReducer(s, {
      type: "submit-password",
      id: "b",
      password: "pw",
    });
    expect(next.outcome).toEqual({ kind: "idle" });
  });

  it("keeps a finished PDF when only the prompt is skipped or reopened", () => {
    const s = state(
      [
        item("a", ready(1)),
        item("b", { kind: "needs-password", wrong: false, dismissed: false }),
      ],
      { kind: "done", pdf, pageCount: 1 },
    );
    expect(
      mergeReducer(s, { type: "dismiss-password", id: "b" }).outcome.kind,
    ).toBe("done");
  });
});
