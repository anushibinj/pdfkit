import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  applyToPoint,
  applyToVector,
  compose,
  invert,
  toSvgTransform,
  type Matrix,
} from "./affine";

const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const scale = (s: number): Matrix => [s, 0, 0, s, 0, 0];
const rotate90ccw: Matrix = [0, 1, -1, 0, 0, 0];

describe("applyToPoint", () => {
  it("applies the linear part and the translation", () => {
    expect(applyToPoint([2, 0, 0, 3, 5, 7], { x: 1, y: 1 })).toEqual({
      x: 7,
      y: 10,
    });
    expect(applyToPoint(rotate90ccw, { x: 1, y: 0 })).toEqual({ x: 0, y: 1 });
  });
});

describe("applyToVector", () => {
  it("ignores the translation", () => {
    expect(applyToVector(translate(100, 100), { x: 3, y: 4 })).toEqual({
      x: 3,
      y: 4,
    });
    expect(applyToVector([2, 0, 0, 2, 9, 9], { x: 3, y: 4 })).toEqual({
      x: 6,
      y: 8,
    });
  });
});

describe("compose", () => {
  it("applies the inner transform first", () => {
    const m = compose(translate(10, 0), scale(2));
    // scale first: (1,1) -> (2,2), then translate -> (12,2)
    expect(applyToPoint(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
    const n = compose(scale(2), translate(10, 0));
    expect(applyToPoint(n, { x: 1, y: 1 })).toEqual({ x: 22, y: 2 });
  });

  it("has the identity as neutral element", () => {
    const m: Matrix = [1, 2, 3, 4, 5, 6];
    expect(compose(IDENTITY, m)).toEqual(m);
    expect(compose(m, IDENTITY)).toEqual(m);
  });
});

describe("invert", () => {
  it("undoes rotations, scales and translations", () => {
    const m = compose(translate(30, -4), compose(rotate90ccw, scale(3)));
    const p = { x: 7, y: -2 };
    const back = applyToPoint(invert(m), applyToPoint(m, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
    const id = compose(invert(m), m);
    id.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i]));
  });

  it("refuses a degenerate matrix", () => {
    expect(() => invert([0, 0, 0, 0, 1, 1])).toThrow("not invertible");
  });
});

describe("toSvgTransform", () => {
  it("formats the six values in PDF order", () => {
    expect(toSvgTransform([1, 0, 0, -1, 5, 6])).toBe("matrix(1 0 0 -1 5 6)");
  });
});
