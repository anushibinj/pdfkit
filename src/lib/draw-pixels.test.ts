import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawPixels } from "./draw-pixels";

const putImageData = vi.fn();

beforeEach(() => {
  putImageData.mockClear();
  // jsdom has no canvas implementation
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ putImageData }) as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("drawPixels", () => {
  it("sizes the canvas and puts the pixels at the origin", () => {
    const canvas = document.createElement("canvas");
    drawPixels(canvas, 2, 1, new ArrayBuffer(8));
    expect([canvas.width, canvas.height]).toEqual([2, 1]);
    expect(putImageData).toHaveBeenCalledWith(
      expect.objectContaining({ width: 2, height: 1 }),
      0,
      0,
    );
  });

  it("does nothing more without a 2D context", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const canvas = document.createElement("canvas");
    expect(() => drawPixels(canvas, 1, 1, new ArrayBuffer(4))).not.toThrow();
    expect(putImageData).not.toHaveBeenCalled();
  });
});
