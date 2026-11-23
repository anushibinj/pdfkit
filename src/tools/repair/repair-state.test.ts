import { describe, expect, it } from "vitest";
import type { RepairReport } from "./core/model";
import {
  INITIAL_REPAIR_STATE,
  repairReducer,
  type RepairState,
} from "./repair-state";

const mockFile = new File(["broken"], "test.pdf", {
  type: "application/pdf",
});

const sampleReport: RepairReport = {
  headerRepaired: true,
  eofRepaired: false,
  xrefReconstructed: true,
  trailerReconstructed: true,
  objectsRecovered: 5,
  streamsRepaired: 0,
  pagesRecovered: 1,
  issues: ["Header fixed"],
};

describe("repairReducer", () => {
  it("starts in idle state", () => {
    expect(INITIAL_REPAIR_STATE).toEqual({ kind: "idle" });
  });

  it("transitions to ready when a file is selected", () => {
    const next = repairReducer(INITIAL_REPAIR_STATE, {
      type: "select-file",
      file: mockFile,
    });
    expect(next).toEqual({ kind: "ready", file: mockFile });
  });

  it("transitions back to idle when clear-file is dispatched", () => {
    const readyState: RepairState = { kind: "ready", file: mockFile };
    const next = repairReducer(readyState, { type: "clear-file" });
    expect(next).toEqual({ kind: "idle" });
  });

  it("transitions from ready to repairing on start-repair", () => {
    const readyState: RepairState = { kind: "ready", file: mockFile };
    const next = repairReducer(readyState, { type: "start-repair" });
    expect(next.kind).toBe("repairing");
    if (next.kind === "repairing") {
      expect(next.file).toBe(mockFile);
      expect(next.progress).toBe(0);
    }
  });

  it("updates progress and stage while repairing", () => {
    const repairingState: RepairState = {
      kind: "repairing",
      file: mockFile,
      progress: 0.1,
      stage: "Scanning",
    };
    const next = repairReducer(repairingState, {
      type: "progress",
      progress: 0.6,
      stage: "Rebuilding",
    });
    expect(next).toEqual({
      kind: "repairing",
      file: mockFile,
      progress: 0.6,
      stage: "Rebuilding",
    });
  });

  it("transitions from repairing to repaired on repair-success", () => {
    const repairingState: RepairState = {
      kind: "repairing",
      file: mockFile,
      progress: 0.8,
    };
    const mockBlob = new Blob(["repaired"], { type: "application/pdf" });

    const next = repairReducer(repairingState, {
      type: "repair-success",
      pdf: mockBlob,
      pageCount: 3,
      report: sampleReport,
      warnings: "Minor syntax warning",
    });

    expect(next).toEqual({
      kind: "repaired",
      file: mockFile,
      pdf: mockBlob,
      pageCount: 3,
      report: sampleReport,
      warnings: "Minor syntax warning",
    });
  });

  it("transitions from repairing to password-required", () => {
    const repairingState: RepairState = {
      kind: "repairing",
      file: mockFile,
      progress: 0.5,
    };
    const next = repairReducer(repairingState, {
      type: "repair-password-required",
      error: "Incorrect password",
    });
    expect(next).toEqual({
      kind: "password-required",
      file: mockFile,
      error: "Incorrect password",
    });
  });

  it("transitions from repairing to unrecoverable", () => {
    const repairingState: RepairState = {
      kind: "repairing",
      file: mockFile,
      progress: 0.5,
    };
    const next = repairReducer(repairingState, {
      type: "repair-unrecoverable",
      reason: "No indirect objects detected",
    });
    expect(next).toEqual({
      kind: "unrecoverable",
      file: mockFile,
      reason: "No indirect objects detected",
    });
  });

  it("transitions from repairing to error", () => {
    const repairingState: RepairState = {
      kind: "repairing",
      file: mockFile,
      progress: 0.5,
    };
    const next = repairReducer(repairingState, {
      type: "repair-error",
      message: "Worker crashed",
    });
    expect(next).toEqual({
      kind: "error",
      file: mockFile,
      message: "Worker crashed",
    });
  });

  it("transitions back to ready on cancel", () => {
    const repairingState: RepairState = {
      kind: "repairing",
      file: mockFile,
      progress: 0.5,
    };
    const next = repairReducer(repairingState, { type: "cancel" });
    expect(next).toEqual({
      kind: "ready",
      file: mockFile,
    });
  });

  it("ignores late success/failure actions if state is not repairing", () => {
    const readyState: RepairState = { kind: "ready", file: mockFile };
    const next = repairReducer(readyState, {
      type: "repair-unrecoverable",
      reason: "late",
    });
    expect(next).toBe(readyState);
  });
});
