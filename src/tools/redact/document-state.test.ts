import { describe, expect, it } from "vitest";
import type { RedactionMark } from "./core/model";
import {
  IDLE_JOB,
  INITIAL_DOCUMENT_STATUS,
  documentReducer,
  jobProgress,
  marksReducer,
} from "./document-state";

function sampleMark(id: string, left = 10, enabled = true): RedactionMark {
  return {
    id,
    pageIndex: 0,
    box: { left, bottom: 10, right: left + 40, top: 30 },
    term: "secret",
    source: "text",
    label: "Text",
    enabled,
  };
}

describe("document-state", () => {
  it("transitions document status across opening, password prompt, ready, failed, and reset", () => {
    const opening = documentReducer(INITIAL_DOCUMENT_STATUS, {
      type: "opening",
      fileName: "doc.pdf",
    });
    expect(opening).toEqual({ kind: "opening", fileName: "doc.pdf" });

    const needsPw = documentReducer(opening, {
      type: "opened",
      result: { status: "needs-password", wrong: false },
    });
    expect(needsPw).toEqual({
      kind: "needs-password",
      fileName: "doc.pdf",
      wrong: false,
    });

    const ready = documentReducer(opening, {
      type: "opened",
      result: {
        status: "opened",
        pages: [
          { box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 },
        ],
      },
    });
    expect(ready.kind).toBe("ready");

    // Late answer after reset is ignored.
    const reset = documentReducer(ready, { type: "reset" });
    expect(reset).toEqual(INITIAL_DOCUMENT_STATUS);
    expect(
      documentReducer(reset, {
        type: "opened",
        result: { status: "opened", pages: [] },
      }),
    ).toEqual(INITIAL_DOCUMENT_STATUS);

    expect(
      documentReducer(reset, {
        type: "read-failed",
        fileName: "bad.pdf",
        message: "Disk error",
      }),
    ).toEqual({
      kind: "failed",
      fileName: "bad.pdf",
      message: "Disk error",
    });
  });

  it("manages marks list with batch deduplication, toggling, bulk selection, and removal", () => {
    let list = marksReducer([], { type: "add", mark: sampleMark("m1", 10) });
    expect(list).toHaveLength(1);

    // Duplicate box at x=10 is ignored; new box at x=100 is added.
    list = marksReducer(list, {
      type: "add-batch",
      marks: [sampleMark("dup", 10.2), sampleMark("m2", 100)],
    });
    expect(list.map((m) => m.id)).toEqual(["m1", "m2"]);

    list = marksReducer(list, { type: "toggle", id: "m1" });
    expect(list[0].enabled).toBe(false);

    list = marksReducer(list, { type: "set-all", enabled: true });
    expect(list.every((m) => m.enabled)).toBe(true);

    list = marksReducer(list, { type: "remove", id: "m1" });
    expect(list.map((m) => m.id)).toEqual(["m2"]);

    list = marksReducer(list, { type: "clear" });
    expect(list).toEqual([]);
  });

  it("maps job progress across redacting, cleaning, and verifying stages", () => {
    expect(jobProgress(IDLE_JOB)).toBe(0);
    expect(
      jobProgress({ kind: "working", stage: "redacting", fraction: 0.5 }),
    ).toBeCloseTo(0.25, 5);
    expect(
      jobProgress({ kind: "working", stage: "cleaning", fraction: 0.5 }),
    ).toBeCloseTo(0.625, 5);
    expect(
      jobProgress({ kind: "working", stage: "verifying", fraction: 1 }),
    ).toBeCloseTo(1, 5);
  });
});
