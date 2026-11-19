import { describe, expect, it } from "vitest";
import { createDocument } from "./editor-state";
import type { EditorDocument, ImageAsset, ImageObject } from "./model";
import { buildSavePlan } from "./save-plan";

const image = (id: string, imageId: string): ImageObject => ({
  id,
  kind: "image",
  x: 0,
  y: 0,
  rotation: 0,
  width: 10,
  height: 10,
  imageId,
});
const asset = (id: string): ImageAsset => ({
  id,
  mime: "image/png",
  bytes: new ArrayBuffer(4),
  pixelWidth: 1,
  pixelHeight: 1,
});

describe("buildSavePlan", () => {
  it("lists pages in output order with their rotation and objects", () => {
    const base = createDocument(3);
    const doc: EditorDocument = {
      pages: [
        { ...base.pages[2], rotation: 1 },
        { ...base.pages[0], objects: [image("o1", "a")] },
      ],
    };
    const assets = new Map([
      ["a", asset("a")],
      ["unused", asset("unused")],
    ]);
    const plan = buildSavePlan(doc, assets);
    expect(plan.pages).toEqual([
      { sourceIndex: 2, rotation: 1, objects: [] },
      { sourceIndex: 0, rotation: 0, objects: [image("o1", "a")] },
    ]);
    // only the image that is actually used is sent
    expect(plan.images).toEqual([
      { id: "a", mime: "image/png", bytes: assets.get("a")!.bytes },
    ]);
  });

  it("sends a shared image once", () => {
    const base = createDocument(2);
    const doc: EditorDocument = {
      pages: base.pages.map((p, i) => ({
        ...p,
        objects: [image(`o${i}`, "a")],
      })),
    };
    expect(
      buildSavePlan(doc, new Map([["a", asset("a")]])).images,
    ).toHaveLength(1);
  });

  it("fails loudly when an asset is missing", () => {
    const doc: EditorDocument = {
      pages: [{ ...createDocument(1).pages[0], objects: [image("o", "gone")] }],
    };
    expect(() => buildSavePlan(doc, new Map())).toThrow("Missing image gone");
  });
});
