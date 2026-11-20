import { describe, expect, it } from "vitest";
import {
  INITIAL_PROTECTION_STATE,
  protectionReducer,
  type ProtectionAction,
  type ProtectionState,
} from "./protection-state";

const pdf = new Blob(["%PDF"], { type: "application/pdf" });
const idle = INITIAL_PROTECTION_STATE;
const protecting: ProtectionState = { kind: "protecting" };
const done: ProtectionState = {
  kind: "done",
  pdf,
  replacedRestrictions: false,
};
const already: ProtectionState = { kind: "already-protected" };
const error: ProtectionState = {
  kind: "error",
  reason: "failed",
  message: "x",
};
const settled = [done, already, error];

const succeed: ProtectionAction = {
  type: "succeed",
  pdf,
  replacedRestrictions: true,
  warnings: "w",
};
const fail: ProtectionAction = {
  type: "fail",
  reason: "crashed",
  message: "boom",
};

describe("protectionReducer", () => {
  it("starts idle", () => {
    expect(INITIAL_PROTECTION_STATE).toEqual({ kind: "idle" });
  });

  it("start: begins protecting from idle or any settled state", () => {
    for (const s of [idle, ...settled]) {
      expect(protectionReducer(s, { type: "start" })).toEqual(protecting);
    }
  });

  it("start: is ignored while already protecting", () => {
    expect(protectionReducer(protecting, { type: "start" })).toBe(protecting);
  });

  it("succeed: stores the PDF and its notes only while protecting", () => {
    expect(protectionReducer(protecting, succeed)).toEqual({
      kind: "done",
      pdf,
      replacedRestrictions: true,
      warnings: "w",
    });
    expect(protectionReducer(idle, succeed)).toBe(idle);
  });

  it("refuse: reports an already protected PDF only while protecting", () => {
    expect(protectionReducer(protecting, { type: "refuse" })).toEqual(already);
    expect(protectionReducer(done, { type: "refuse" })).toBe(done);
  });

  it("fail: stores the error only while protecting", () => {
    expect(protectionReducer(protecting, fail)).toEqual({
      kind: "error",
      reason: "crashed",
      message: "boom",
    });
    expect(protectionReducer(already, fail)).toBe(already);
  });

  it("cancel: returns to idle only while protecting", () => {
    expect(protectionReducer(protecting, { type: "cancel" })).toEqual(idle);
    expect(protectionReducer(done, { type: "cancel" })).toBe(done);
  });

  it("password-changed: drops a finished PDF and an error", () => {
    expect(protectionReducer(done, { type: "password-changed" })).toEqual(idle);
    expect(protectionReducer(error, { type: "password-changed" })).toEqual(
      idle,
    );
  });

  it("password-changed: keeps 'already protected', idle and a running job", () => {
    for (const s of [already, idle, protecting]) {
      expect(protectionReducer(s, { type: "password-changed" })).toBe(s);
    }
  });

  it("file-changed: drops every settled result", () => {
    for (const s of settled) {
      expect(protectionReducer(s, { type: "file-changed" })).toEqual(idle);
    }
  });

  it("file-changed: keeps idle and a running job", () => {
    for (const s of [idle, protecting]) {
      expect(protectionReducer(s, { type: "file-changed" })).toBe(s);
    }
  });
});
