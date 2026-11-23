import { describe, expect, it } from "vitest";
import { DEFAULT_COMPRESS_OPTIONS } from "./core/options";
import { compressReducer, INITIAL_COMPRESS_STATE } from "./compress-state";

describe("compressReducer", () => {
  const fileA = new File(["a"], "a.pdf", { type: "application/pdf" });
  const fileB = new File(["b"], "b.pdf", { type: "application/pdf" });

  it("adds, removes, and clears files", () => {
    let state = compressReducer(INITIAL_COMPRESS_STATE, {
      type: "add-files",
      entries: [
        { id: "1", file: fileA },
        { id: "2", file: fileB },
      ],
    });
    expect(state.items).toHaveLength(2);

    state = compressReducer(state, { type: "remove-file", id: "1" });
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("2");

    state = compressReducer(state, { type: "clear" });
    expect(state.items).toHaveLength(0);
  });

  it("resets compressed results when options change", () => {
    let state = compressReducer(INITIAL_COMPRESS_STATE, {
      type: "add-files",
      entries: [{ id: "1", file: fileA }],
    });
    state = compressReducer(state, {
      type: "item-compressed",
      id: "1",
      pdf: new Blob(["ok"]),
      pageCount: 1,
      originalBytes: 100,
      compressedBytes: 50,
      report: {
        originalBytes: 100,
        compressedBytes: 50,
        imagesInspected: 0,
        imagesReencoded: 0,
        imagesDownsampled: 0,
        imagesDeduplicated: 0,
        imagesSkippedLarger: 0,
        flateStreamsRecompressed: 0,
        objectsRemoved: 0,
        transparencyPreserved: 0,
        notes: [],
      },
      appliedConfig: { lossless: true, targetDpi: 0, quality: 1, grayscale: false },
    });
    expect(state.items[0].status.kind).toBe("compressed");

    state = compressReducer(state, {
      type: "set-options",
      options: { ...DEFAULT_COMPRESS_OPTIONS, preset: "small" },
    });
    expect(state.items[0].status.kind).toBe("ready");
  });

  it("manages password prompts and preview lifecycle", () => {
    let state = compressReducer(INITIAL_COMPRESS_STATE, {
      type: "add-files",
      entries: [{ id: "1", file: fileA }],
    });
    state = compressReducer(state, {
      type: "item-password-required",
      id: "1",
      wrongPassword: false,
    });
    expect(state.items[0].status.kind).toBe("password-required");

    state = compressReducer(state, { type: "dismiss-password", id: "1" });
    expect(
      state.items[0].status.kind === "password-required" &&
        state.items[0].status.dismissed,
    ).toBe(true);

    state = compressReducer(state, { type: "reopen-password", id: "1" });
    expect(
      state.items[0].status.kind === "password-required" &&
        !state.items[0].status.dismissed,
    ).toBe(true);

    state = compressReducer(state, {
      type: "open-preview",
      itemId: "1",
      pageIndex: 0,
      pageCount: 2,
    });
    expect(state.preview?.loading).toBe(true);

    state = compressReducer(state, {
      type: "preview-loaded",
      itemId: "1",
      pageIndex: 0,
      pageCount: 2,
      width: 10,
      height: 15,
      originalPixels: new Uint8Array(10 * 15 * 4),
      compressedPixels: new Uint8Array(10 * 15 * 4),
    });
    expect(state.preview?.loading).toBe(false);
    expect(state.preview?.width).toBe(10);

    state = compressReducer(state, { type: "close-preview" });
    expect(state.preview).toBeNull();
  });
});
