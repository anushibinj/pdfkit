import { describe, expect, it } from "vitest";
import { fakeImagesPdfium } from "../test-utils/fake-images-pdfium";
import { MAX_FORM_DEPTH, collectImageObjects } from "./image-objects";
import { PAGE_OBJECT } from "./pdfium-api";

/**
 * A page tree for the fake: page children and form children by handle, and
 * each handle's type.
 */
function tree(
  pageChildren: number[],
  forms: Record<number, number[]>,
  types: Record<number, number>,
) {
  const { api } = fakeImagesPdfium();
  api.FPDFPage_CountObjects.mockReturnValue(pageChildren.length);
  api.FPDFPage_GetObject.mockImplementation((_p, i) => pageChildren[i]);
  api.FPDFPageObj_GetType.mockImplementation((o) => types[o] ?? 1);
  api.FPDFFormObj_CountObjects.mockImplementation((f) => forms[f]?.length ?? 0);
  api.FPDFFormObj_GetObject.mockImplementation((f, i) => forms[f][i]);
  return api;
}

const { IMAGE, FORM } = PAGE_OBJECT;

describe("collectImageObjects", () => {
  it("lists images in content order, forms' images at the form's position", () => {
    const api = tree(
      [1, 2, 3, 4],
      { 2: [20, 21] },
      {
        1: IMAGE,
        2: FORM,
        20: IMAGE,
        21: 2, // a path
        3: 1, // text
        4: IMAGE,
      },
    );
    expect(collectImageObjects(api, 99)).toEqual([1, 20, 4]);
    expect(api.FPDFPage_CountObjects).toHaveBeenCalledWith(99);
  });

  it("recurses into nested forms and skips null handles", () => {
    const api = tree(
      [0, 1],
      { 1: [2, 0], 2: [3] },
      { 1: FORM, 2: FORM, 3: IMAGE },
    );
    expect(collectImageObjects(api, 1)).toEqual([3]);
  });

  it("stops descending at the depth limit", () => {
    // A chain of forms deeper than the limit, with an image at the bottom.
    const forms: Record<number, number[]> = {};
    const types: Record<number, number> = {};
    const depth = MAX_FORM_DEPTH + 5;
    for (let i = 1; i <= depth; i++) {
      forms[i] = [i + 1];
      types[i] = FORM;
    }
    types[depth + 1] = IMAGE;
    const api = tree([1], forms, types);
    expect(collectImageObjects(api, 1)).toEqual([]);
    expect(api.FPDFFormObj_CountObjects).toHaveBeenCalledTimes(MAX_FORM_DEPTH);
  });
});
