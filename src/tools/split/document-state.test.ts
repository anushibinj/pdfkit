import { describe, expect, it } from "vitest";
import {
  INITIAL_DOCUMENT_STATUS,
  documentReducer,
  type DocumentStatus,
} from "./document-state";

const opening = (withPassword = false): DocumentStatus => ({
  kind: "opening",
  fileName: "a.pdf",
  fileSize: 10,
  withPassword,
});
const pages = [{ width: 1, height: 2 }];

describe("documentReducer", () => {
  it("starts opening a file", () => {
    expect(
      documentReducer(INITIAL_DOCUMENT_STATUS, {
        type: "opening",
        fileName: "a.pdf",
        fileSize: 10,
        withPassword: false,
      }),
    ).toEqual(opening());
  });

  it("becomes ready with the pages and remembers whether a password was used", () => {
    expect(
      documentReducer(opening(true), {
        type: "opened",
        result: { status: "opened", pages },
      }),
    ).toEqual({
      kind: "ready",
      fileName: "a.pdf",
      fileSize: 10,
      pages,
      withPassword: true,
    });
  });

  it("asks for a password, and says when the last one was wrong", () => {
    expect(
      documentReducer(opening(), {
        type: "opened",
        result: { status: "password-required" },
      }),
    ).toEqual({ kind: "needs-password", fileName: "a.pdf", fileSize: 10, wrong: false });
    expect(
      documentReducer(opening(true), {
        type: "opened",
        result: { status: "wrong-password" },
      }),
    ).toMatchObject({ kind: "needs-password", wrong: true });
  });

  it("fails with the worker's message, or a read error", () => {
    expect(
      documentReducer(opening(), {
        type: "opened",
        result: { status: "error", reason: "failed", message: "Not a PDF" },
      }),
    ).toEqual({ kind: "failed", fileName: "a.pdf", message: "Not a PDF" });
    expect(
      documentReducer(INITIAL_DOCUMENT_STATUS, {
        type: "read-failed",
        fileName: "b.pdf",
        message: "NotReadableError",
      }),
    ).toEqual({ kind: "failed", fileName: "b.pdf", message: "NotReadableError" });
  });

  it("ignores a late answer when nothing is being opened", () => {
    const empty = INITIAL_DOCUMENT_STATUS;
    expect(
      documentReducer(empty, { type: "opened", result: { status: "opened", pages } }),
    ).toBe(empty);
  });

  it("resets to empty, keeping the same object when already empty", () => {
    expect(documentReducer(opening(), { type: "reset" })).toBe(INITIAL_DOCUMENT_STATUS);
    expect(documentReducer(INITIAL_DOCUMENT_STATUS, { type: "reset" })).toBe(
      INITIAL_DOCUMENT_STATUS,
    );
  });
});
