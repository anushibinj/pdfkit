import { describe, expect, it } from "vitest";
import {
  INITIAL_DOCUMENT_STATUS,
  documentReducer,
  jobProgress,
  type DocumentStatus,
} from "./document-state";

const pages = [
  {
    box: { left: 0, bottom: 0, right: 1, top: 1 },
    rotation: 0 as const,
  },
];

describe("documentReducer", () => {
  const opening: DocumentStatus = { kind: "opening", fileName: "a.pdf" };

  it("goes from opening to ready or failed", () => {
    expect(
      documentReducer(INITIAL_DOCUMENT_STATUS, {
        type: "opening",
        fileName: "a.pdf",
      }),
    ).toEqual(opening);
    expect(
      documentReducer(opening, {
        type: "opened",
        result: { status: "opened", pages },
      }),
    ).toEqual({ kind: "ready", fileName: "a.pdf", pages });
    expect(
      documentReducer(opening, {
        type: "opened",
        result: { status: "encrypted", message: "Protected." },
      }),
    ).toEqual({ kind: "failed", fileName: "a.pdf", message: "Protected." });
    expect(
      documentReducer(opening, {
        type: "opened",
        result: { status: "error", reason: "failed", message: "Broken." },
      }),
    ).toEqual({ kind: "failed", fileName: "a.pdf", message: "Broken." });
  });

  it("ignores a late answer when no file is being opened", () => {
    const ready: DocumentStatus = { kind: "ready", fileName: "b.pdf", pages };
    expect(
      documentReducer(ready, {
        type: "opened",
        result: { status: "opened", pages },
      }),
    ).toBe(ready);
  });

  it("records read failures and resets", () => {
    expect(
      documentReducer(opening, {
        type: "read-failed",
        fileName: "a.pdf",
        message: "m",
      }),
    ).toEqual({ kind: "failed", fileName: "a.pdf", message: "m" });
    expect(documentReducer(opening, { type: "reset" })).toEqual(
      INITIAL_DOCUMENT_STATUS,
    );
    expect(documentReducer(INITIAL_DOCUMENT_STATUS, { type: "reset" })).toBe(
      INITIAL_DOCUMENT_STATUS,
    );
  });
});

describe("jobProgress", () => {
  it("weights checking more when content is removed", () => {
    expect(jobProgress({ kind: "idle" }, true)).toBe(0);
    expect(
      jobProgress({ kind: "working", stage: "cropping", fraction: 1 }, true),
    ).toBeCloseTo(0.2);
    expect(
      jobProgress({ kind: "working", stage: "checking", fraction: 0.5 }, true),
    ).toBeCloseTo(0.6);
    expect(
      jobProgress({ kind: "working", stage: "cropping", fraction: 0.5 }, false),
    ).toBe(0.5);
  });
});
