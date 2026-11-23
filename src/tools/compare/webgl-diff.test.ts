import { describe, expect, it, vi } from "vitest";
import {
  DIFF_FRAGMENT_SHADER,
  DIFF_VERTEX_SHADER,
  renderVisualDiffWebGl,
} from "./webgl-diff";

describe("webgl-diff", () => {
  it("exposes valid GLSL shaders and returns false when WebGL is unavailable (jsdom)", () => {
    expect(DIFF_VERTEX_SHADER).toContain("v_uv");
    expect(DIFF_FRAGMENT_SHADER).toContain("u_leftTex");
    expect(DIFF_FRAGMENT_SHADER).toContain("u_rightTex");

    const canvas = document.createElement("canvas");
    const ok = renderVisualDiffWebGl(canvas, {
      leftPixels: new Uint8Array(16),
      leftWidth: 2,
      leftHeight: 2,
      rightPixels: new Uint8Array(16),
      rightWidth: 2,
      rightHeight: 2,
      threshold: 14,
    });
    expect(ok).toBe(false);
  });

  it("renders aligned textures and cleans up GL resources when WebGL context exists", () => {
    const fakeGl = {
      VERTEX_SHADER: 1,
      FRAGMENT_SHADER: 2,
      COMPILE_STATUS: 3,
      LINK_STATUS: 4,
      TEXTURE_2D: 5,
      TEXTURE_WRAP_S: 6,
      TEXTURE_WRAP_T: 7,
      TEXTURE_MIN_FILTER: 8,
      TEXTURE_MAG_FILTER: 9,
      CLAMP_TO_EDGE: 10,
      NEAREST: 11,
      RGBA: 12,
      UNSIGNED_BYTE: 13,
      ARRAY_BUFFER: 14,
      STATIC_DRAW: 15,
      FLOAT: 16,
      TEXTURE0: 17,
      TEXTURE1: 18,
      TRIANGLE_STRIP: 19,
      createShader: vi.fn(() => ({})),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      deleteShader: vi.fn(),
      createProgram: vi.fn(() => ({})),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true),
      deleteProgram: vi.fn(),
      createBuffer: vi.fn(() => ({})),
      deleteBuffer: vi.fn(),
      createTexture: vi.fn(() => ({})),
      deleteTexture: vi.fn(),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      texImage2D: vi.fn(),
      viewport: vi.fn(),
      useProgram: vi.fn(),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      getAttribLocation: vi.fn(() => 0),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      activeTexture: vi.fn(),
      getUniformLocation: vi.fn(() => ({})),
      uniform1i: vi.fn(),
      uniform2f: vi.fn(),
      uniform1f: vi.fn(),
      drawArrays: vi.fn(),
    } as unknown as WebGLRenderingContext;

    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(fakeGl);

    const ok = renderVisualDiffWebGl(canvas, {
      leftPixels: new Uint8Array(4 * 4 * 4),
      leftWidth: 4,
      leftHeight: 4,
      rightPixels: new Uint8Array(6 * 4 * 4),
      rightWidth: 6,
      rightHeight: 4,
      threshold: 14,
    });

    expect(ok).toBe(true);
    expect(canvas.width).toBe(6);
    expect(canvas.height).toBe(4);
    expect(fakeGl.drawArrays).toHaveBeenCalledWith(fakeGl.TRIANGLE_STRIP, 0, 4);
    expect(fakeGl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(fakeGl.deleteProgram).toHaveBeenCalledTimes(1);
  });
});
