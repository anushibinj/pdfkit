import { describe, expect, it } from "vitest";
import { DEFAULT_OCR_OPTIONS } from "./core/options";
import { buildOcrReport } from "./core/report";
import { INITIAL_OCR_STATE, ocrReducer } from "./ocr-state";

const SAMPLE_FILE = new File([new Uint8Array([1, 2, 3])], "scan.pdf", {
  type: "application/pdf",
});

const SAMPLE_REPORT = buildOcrReport([
  {
    pageIndex: 0,
    status: "ocr",
    text: "Sample recognized text",
    confidence: 92,
    wordCount: 3,
  },
]);

describe("ocrReducer", () => {
  it("adds files, tracks progress, completes, and opens text panel for single file", () => {
    let state = ocrReducer(INITIAL_OCR_STATE, {
      type: "add-files",
      entries: [{ id: "1", file: SAMPLE_FILE }],
    });
    expect(state.items).toHaveLength(1);

    state = ocrReducer(state, { type: "start-batch" });
    state = ocrReducer(state, { type: "start-item", id: "1" });
    state = ocrReducer(state, {
      type: "item-progress",
      id: "1",
      progress: 0.5,
      stage: "Recognizing page 1…",
    });
    expect(state.items[0].status).toEqual({
      kind: "processing",
      progress: 0.5,
      stage: "Recognizing page 1…",
    });

    const blob = new Blob([new Uint8Array([37, 80])], {
      type: "application/pdf",
    });
    state = ocrReducer(state, {
      type: "item-completed",
      id: "1",
      pdf: blob,
      report: SAMPLE_REPORT,
      wasImageInput: false,
    });
    state = ocrReducer(state, { type: "finish-batch" });

    expect(state.isProcessing).toBe(false);
    expect(state.inspectedTextItemId).toBe("1");
    expect(state.items[0].status.kind).toBe("completed");
  });

  it("resets completed items back to ready when options change", () => {
    let state = ocrReducer(INITIAL_OCR_STATE, {
      type: "add-files",
      entries: [{ id: "1", file: SAMPLE_FILE }],
    });
    state = ocrReducer(state, {
      type: "item-completed",
      id: "1",
      pdf: new Blob([]),
      report: SAMPLE_REPORT,
      wasImageInput: false,
    });

    state = ocrReducer(state, {
      type: "set-options",
      options: { ...DEFAULT_OCR_OPTIONS, languages: ["eng", "hin"] },
    });
    expect(state.items[0].status).toEqual({ kind: "ready" });
    expect(state.inspectedTextItemId).toBeNull();
  });

  it("manages password prompts and cancellation cleanly", () => {
    let state = ocrReducer(INITIAL_OCR_STATE, {
      type: "add-files",
      entries: [{ id: "1", file: SAMPLE_FILE }],
    });
    state = ocrReducer(state, {
      type: "item-password-required",
      id: "1",
      wrongPassword: false,
    });
    state = ocrReducer(state, { type: "dismiss-password", id: "1" });
    expect(state.items[0].status).toEqual({
      kind: "password-required",
      wrongPassword: false,
      dismissed: true,
    });
    state = ocrReducer(state, { type: "reopen-password", id: "1" });
    expect(state.items[0].status).toEqual({
      kind: "password-required",
      wrongPassword: false,
      dismissed: false,
    });

    state = ocrReducer(state, {
      type: "submit-password",
      id: "1",
      password: "secret",
    });
    expect(state.items[0].password).toBe("secret");
    expect(state.items[0].status).toEqual({ kind: "ready" });

    state = ocrReducer(state, { type: "start-batch" });
    state = ocrReducer(state, { type: "start-item", id: "1" });
    state = ocrReducer(state, { type: "cancel-batch" });
    expect(state.isProcessing).toBe(false);
    expect(state.items[0].status).toEqual({ kind: "ready" });
  });
});
