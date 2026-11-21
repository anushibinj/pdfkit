import { describe, expect, it, vi } from "vitest";
import { check, insertNewObject, type ObjectTarget } from "./page-objects";

const PAGE = 7;

function setup() {
  const api = {
    FPDFPage_InsertObject: vi.fn(),
    FPDFPageObj_Transform: vi.fn(),
    FPDFPageObj_Destroy: vi.fn(),
  };
  const ctx: ObjectTarget = { api, page: PAGE };
  return { api, ctx };
}

describe("check", () => {
  it("passes truthy results and throws on failure", () => {
    expect(() => check(true, "x")).not.toThrow();
    expect(() => check(1, "x")).not.toThrow();
    expect(() => check(false, "draw")).toThrow("PDFium could not draw");
    expect(() => check(0, "draw")).toThrow("PDFium could not draw");
  });
});

describe("insertNewObject", () => {
  it("configures, transforms and inserts the object", () => {
    const { api, ctx } = setup();
    const configure = vi.fn();
    insertNewObject(ctx, () => 55, configure, [1, 2, 3, 4, 5, 6], "a thing");
    expect(configure).toHaveBeenCalledWith(55);
    expect(api.FPDFPageObj_Transform).toHaveBeenCalledWith(
      55,
      1,
      2,
      3,
      4,
      5,
      6,
    );
    expect(api.FPDFPage_InsertObject).toHaveBeenCalledWith(PAGE, 55);
    expect(api.FPDFPageObj_Destroy).not.toHaveBeenCalled();
  });

  it("destroys the object when configuring fails, and never inserts it", () => {
    const { api, ctx } = setup();
    expect(() =>
      insertNewObject(
        ctx,
        () => 55,
        () => {
          throw new Error("bad");
        },
        [1, 0, 0, 1, 0, 0],
        "a thing",
      ),
    ).toThrow("bad");
    expect(api.FPDFPageObj_Destroy).toHaveBeenCalledWith(55);
    expect(api.FPDFPage_InsertObject).not.toHaveBeenCalled();
  });

  it("reports a failed creation", () => {
    const { ctx } = setup();
    expect(() =>
      insertNewObject(ctx, () => 0, vi.fn(), [1, 0, 0, 1, 0, 0], "a thing"),
    ).toThrow("PDFium could not create a thing");
  });
});
