import { describe, expect, it } from "vitest";
import {
  INITIAL_DOCUMENT_STATUS,
  documentReducer,
  type DocumentStatus,
} from "./document-state";

const opening: DocumentStatus = { kind: "opening", fileName: "a.pdf" };

describe("documentReducer", () => {
  it("goes from opening to ready with the page count", () => {
    expect(
      documentReducer(opening, {
        type: "opened",
        result: { status: "opened", pageCount: 4 },
      }),
    ).toEqual({ kind: "ready", fileName: "a.pdf", pageCount: 4 });
  });

  it.each([
    ["password-required", false],
    ["wrong-password", true],
  ] as const)("asks for a password on %s", (status, wrong) => {
    expect(
      documentReducer(opening, { type: "opened", result: { status } }),
    ).toEqual({ kind: "needs-password", fileName: "a.pdf", wrong });
  });

  it("fails with the worker's message, or when the file cannot be read", () => {
    expect(
      documentReducer(opening, {
        type: "opened",
        result: { status: "error", reason: "failed", message: "Damaged." },
      }),
    ).toEqual({ kind: "failed", fileName: "a.pdf", message: "Damaged." });
    expect(
      documentReducer(INITIAL_DOCUMENT_STATUS, {
        type: "read-failed",
        fileName: "b.pdf",
        message: "NotReadableError",
      }),
    ).toEqual({
      kind: "failed",
      fileName: "b.pdf",
      message: "NotReadableError",
    });
  });

  it("ignores a late answer when nothing is being opened", () => {
    const ready: DocumentStatus = {
      kind: "ready",
      fileName: "b.pdf",
      pageCount: 1,
    };
    expect(
      documentReducer(ready, {
        type: "opened",
        result: { status: "opened", pageCount: 9 },
      }),
    ).toBe(ready);
  });

  it("resets to empty, keeping the same object when already empty", () => {
    expect(documentReducer(opening, { type: "reset" })).toBe(
      INITIAL_DOCUMENT_STATUS,
    );
    expect(documentReducer(INITIAL_DOCUMENT_STATUS, { type: "reset" })).toBe(
      INITIAL_DOCUMENT_STATUS,
    );
  });

  it("starts opening another file from any state", () => {
    expect(
      documentReducer(INITIAL_DOCUMENT_STATUS, {
        type: "opening",
        fileName: "c.pdf",
      }),
    ).toEqual({ kind: "opening", fileName: "c.pdf" });
  });
});
