import { describe, expect, it } from "vitest";
import {
  INITIAL_DOCUMENT_STATUS,
  documentReducer,
  type DocumentStatus,
} from "./document-state";
import type { OpenResult } from "./messages";

const opening: DocumentStatus = { kind: "opening", fileName: "a.pdf" };
const page = {
  box: { left: 0, bottom: 0, right: 1, top: 1 },
  rotation: 0 as const,
};

describe("documentReducer", () => {
  it("starts empty", () => {
    expect(INITIAL_DOCUMENT_STATUS).toEqual({ kind: "empty" });
  });

  it("opening remembers the file name", () => {
    expect(
      documentReducer(INITIAL_DOCUMENT_STATUS, {
        type: "opening",
        fileName: "a.pdf",
      }),
    ).toEqual(opening);
  });

  const cases: [OpenResult, DocumentStatus][] = [
    [
      { status: "opened", pages: [page] },
      { kind: "ready", fileName: "a.pdf", pages: [page] },
    ],
    [
      { status: "password-required" },
      { kind: "needs-password", fileName: "a.pdf", wrong: false },
    ],
    [
      { status: "wrong-password" },
      { kind: "needs-password", fileName: "a.pdf", wrong: true },
    ],
    [
      { status: "error", reason: "failed", message: "bad" },
      { kind: "failed", fileName: "a.pdf", message: "bad" },
    ],
  ];
  it.each(cases)("opened %j -> %j", (result, expected) => {
    expect(documentReducer(opening, { type: "opened", result })).toEqual(
      expected,
    );
  });

  it("ignores a late answer when nothing is being opened", () => {
    expect(
      documentReducer(INITIAL_DOCUMENT_STATUS, {
        type: "opened",
        result: { status: "wrong-password" },
      }),
    ).toBe(INITIAL_DOCUMENT_STATUS);
  });

  it("read-failed reports the problem", () => {
    expect(
      documentReducer(opening, {
        type: "read-failed",
        fileName: "b.pdf",
        message: "nope",
      }),
    ).toEqual({
      kind: "failed",
      fileName: "b.pdf",
      message: "nope",
    });
  });

  it("reset returns to empty", () => {
    expect(documentReducer(opening, { type: "reset" })).toEqual({
      kind: "empty",
    });
    expect(documentReducer(INITIAL_DOCUMENT_STATUS, { type: "reset" })).toBe(
      INITIAL_DOCUMENT_STATUS,
    );
  });
});
