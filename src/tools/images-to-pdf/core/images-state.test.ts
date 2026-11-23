import { describe, expect, it } from "vitest";
import {
  INITIAL_IMAGES_STATE,
  imagesReducer,
  imagesSummary,
  nextToValidate,
  rotateQuarterTurns,
  type ImageListItem,
} from "./images-state";
import { DEFAULT_LAYOUT_OPTIONS } from "./options";

function makeFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

describe("images-state", () => {
  describe("rotateQuarterTurns", () => {
    it("wraps clockwise and counter-clockwise within 0..3", () => {
      expect(rotateQuarterTurns(0, 1)).toBe(1);
      expect(rotateQuarterTurns(3, 1)).toBe(0);
      expect(rotateQuarterTurns(0, -1)).toBe(3);
      expect(rotateQuarterTurns(2, -1)).toBe(1);
    });
  });

  describe("imagesSummary", () => {
    it("reports blockers in priority order: empty -> validating -> invalid -> ready", () => {
      expect(imagesSummary([])).toEqual({
        imageCount: 0,
        totalBytes: 0,
        blocker: "empty",
      });

      const queued: ImageListItem = {
        id: "1",
        file: makeFile("a.png", 100),
        rotation: 0,
        status: { kind: "queued" },
      };
      const errored: ImageListItem = {
        id: "2",
        file: makeFile("b.png", 200),
        rotation: 0,
        status: { kind: "error", message: "bad" },
      };
      const ready: ImageListItem = {
        id: "3",
        file: makeFile("c.png", 300),
        rotation: 0,
        status: {
          kind: "ready",
          info: { mime: "image/png", width: 10, height: 10 },
        },
      };

      expect(imagesSummary([queued, errored]).blocker).toBe("validating");
      expect(imagesSummary([ready, errored]).blocker).toBe("invalid");
      expect(imagesSummary([ready])).toEqual({
        imageCount: 1,
        totalBytes: 300,
        blocker: undefined,
      });
    });
  });

  describe("nextToValidate", () => {
    it("returns the first queued item only when nothing is currently validating", () => {
      const a: ImageListItem = {
        id: "1",
        file: makeFile("a.png", 10),
        rotation: 0,
        status: { kind: "queued" },
      };
      const b: ImageListItem = {
        id: "2",
        file: makeFile("b.png", 10),
        rotation: 0,
        status: { kind: "validating" },
      };
      expect(nextToValidate([a])).toBe(a);
      expect(nextToValidate([b, a])).toBeUndefined();
    });
  });

  describe("imagesReducer", () => {
    it("handles add, validation lifecycle, reorder, rotate, remove, clear, and options", () => {
      let state = imagesReducer(INITIAL_IMAGES_STATE, {
        type: "add",
        items: [
          { id: "1", file: makeFile("a.png", 10), previewUrl: "blob:1" },
          { id: "2", file: makeFile("b.jpg", 20), previewUrl: "blob:2" },
        ],
      });
      expect(state.items).toHaveLength(2);
      expect(state.items[0].status.kind).toBe("queued");

      state = imagesReducer(state, { type: "validate-started", id: "1" });
      expect(state.items[0].status.kind).toBe("validating");

      state = imagesReducer(state, {
        type: "validated",
        id: "1",
        info: { mime: "image/png", width: 100, height: 50 },
      });
      expect(state.items[0].status).toEqual({
        kind: "ready",
        info: { mime: "image/png", width: 100, height: 50 },
      });

      state = imagesReducer(state, {
        type: "validation-failed",
        id: "2",
        message: "Damaged",
      });
      expect(state.items[1].status).toEqual({
        kind: "error",
        message: "Damaged",
      });

      // Move second item up.
      state = imagesReducer(state, { type: "move", id: "2", offset: -1 });
      expect(state.items.map((i) => i.id)).toEqual(["2", "1"]);

      // Rotate item 1 clockwise.
      state = imagesReducer(state, { type: "rotate", id: "1", delta: 1 });
      expect(state.items[1].rotation).toBe(1);

      // Update layout options.
      const nextOpts = { ...DEFAULT_LAYOUT_OPTIONS, pageSize: "Letter" as const };
      state = imagesReducer(state, { type: "set-options", options: nextOpts });
      expect(state.options.pageSize).toBe("Letter");

      // Remove item 2.
      state = imagesReducer(state, { type: "remove", id: "2" });
      expect(state.items.map((i) => i.id)).toEqual(["1"]);

      // Clear all.
      state = imagesReducer(state, { type: "clear" });
      expect(state.items).toEqual([]);
    });

    it("locks list/option mutations while building and invalidates stale done outcomes", () => {
      let state = imagesReducer(INITIAL_IMAGES_STATE, {
        type: "add",
        items: [{ id: "1", file: makeFile("a.png", 10) }],
      });
      state = imagesReducer(state, { type: "build-started" });
      expect(state.outcome).toEqual({ kind: "building", progress: 0 });

      // Progress clamps to [0, 1].
      state = imagesReducer(state, {
        type: "build-progress",
        progress: 1.5,
        stage: "Saving…",
      });
      expect(state.outcome).toEqual({
        kind: "building",
        progress: 1,
        stage: "Saving…",
      });

      // Mutations while building are ignored.
      expect(imagesReducer(state, { type: "remove", id: "1" })).toBe(state);
      expect(imagesReducer(state, { type: "clear" })).toBe(state);
      expect(
        imagesReducer(state, { type: "rotate", id: "1", delta: 1 }),
      ).toBe(state);
      expect(
        imagesReducer(state, {
          type: "set-options",
          options: { ...DEFAULT_LAYOUT_OPTIONS, marginMm: 0 },
        }),
      ).toBe(state);

      // Build succeeds, then rotating resets outcome to idle.
      const pdf = new Blob([new Uint8Array([1, 2, 3])], {
        type: "application/pdf",
      });
      state = imagesReducer(state, {
        type: "build-succeeded",
        pdf,
        pageCount: 1,
      });
      expect(state.outcome.kind).toBe("done");

      state = imagesReducer(state, { type: "rotate", id: "1", delta: 1 });
      expect(state.outcome).toEqual({ kind: "idle" });

      // Build failed records reason and message.
      state = imagesReducer(state, {
        type: "build-failed",
        reason: "out-of-memory",
        message: "OOM",
      });
      expect(state.outcome).toEqual({
        kind: "error",
        reason: "out-of-memory",
        message: "OOM",
      });
    });
  });
});
