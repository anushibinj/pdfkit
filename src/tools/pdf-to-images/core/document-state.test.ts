import { describe, expect, it } from "vitest";
import {
  INITIAL_DOCUMENT_STATE,
  documentReducer,
  type DocumentState,
} from "./document-state";

const opening: DocumentState = { kind: "opening", fileName: "a.pdf" };

describe("documentReducer", () => {
  it("moves to opening and records read failures", () => {
    expect(
      documentReducer(INITIAL_DOCUMENT_STATE, {
        type: "opening",
        fileName: "a.pdf",
      }),
    ).toEqual(opening);
    expect(
      documentReducer(opening, {
        type: "read-failed",
        fileName: "a.pdf",
        message: "gone",
      }),
    ).toEqual({ kind: "failed", fileName: "a.pdf", message: "gone" });
  });

  it("maps each open result while opening", () => {
    const opened = (
      result: Parameters<typeof documentReducer>[1] & { type: "opened" },
    ) => documentReducer(opening, result);
    expect(
      opened({ type: "opened", result: { status: "opened", pageCount: 4 } }),
    ).toEqual({
      kind: "ready",
      fileName: "a.pdf",
      pageCount: 4,
    });
    expect(
      opened({ type: "opened", result: { status: "password-required" } }),
    ).toEqual({
      kind: "needs-password",
      fileName: "a.pdf",
      wrong: false,
    });
    expect(
      opened({ type: "opened", result: { status: "wrong-password" } }),
    ).toEqual({
      kind: "needs-password",
      fileName: "a.pdf",
      wrong: true,
    });
    expect(
      opened({
        type: "opened",
        result: { status: "error", reason: "failed", message: "damaged" },
      }),
    ).toEqual({ kind: "failed", fileName: "a.pdf", message: "damaged" });
  });

  it("ignores an answer that arrives when nothing is being opened", () => {
    const ready: DocumentState = {
      kind: "ready",
      fileName: "b.pdf",
      pageCount: 1,
    };
    const late = {
      type: "opened" as const,
      result: { status: "opened" as const, pageCount: 9 },
    };
    expect(documentReducer(ready, late)).toBe(ready);
    expect(documentReducer(INITIAL_DOCUMENT_STATE, late)).toBe(
      INITIAL_DOCUMENT_STATE,
    );
  });

  it("resets to empty, keeping an empty state as is", () => {
    expect(documentReducer(opening, { type: "reset" })).toBe(
      INITIAL_DOCUMENT_STATE,
    );
    expect(documentReducer(INITIAL_DOCUMENT_STATE, { type: "reset" })).toBe(
      INITIAL_DOCUMENT_STATE,
    );
  });
});
