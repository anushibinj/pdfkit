/**
 * GPU-accelerated WebGL pixel-difference renderer for Visual Compare mode,
 * with automatic Canvas 2D fallback when WebGL is unavailable.
 */

/** Full-screen quad vertex shader (maps `[-1, 1]` NDC to `[0, 1]` UV). */
export const DIFF_VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/** Fragment shader performing top-left aligned per-pixel difference tinting. */
export const DIFF_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_leftTex;
uniform sampler2D u_rightTex;
uniform vec2 u_leftUvScale;
uniform vec2 u_rightUvScale;
uniform float u_threshold;
varying vec2 v_uv;

vec3 sampleAligned(sampler2D tex, vec2 scale, vec2 uv) {
  if (uv.x > scale.x || uv.y > scale.y) {
    return vec3(1.0, 1.0, 1.0);
  }
  return texture2D(tex, uv / scale).rgb;
}

void main() {
  vec3 leftRgb = sampleAligned(u_leftTex, u_leftUvScale, v_uv);
  vec3 rightRgb = sampleAligned(u_rightTex, u_rightUvScale, v_uv);

  vec3 diff = abs(leftRgb - rightRgb);
  float maxDelta = max(diff.r, max(diff.g, diff.b));

  if (maxDelta <= u_threshold) {
    float luma = dot(rightRgb, vec3(0.299, 0.587, 0.114));
    float muted = luma * 0.25 + 0.75;
    gl_FragColor = vec4(muted, muted, muted, 1.0);
    return;
  }

  float lumaL = dot(leftRgb, vec3(0.299, 0.587, 0.114));
  float lumaR = dot(rightRgb, vec3(0.299, 0.587, 0.114));
  float strength = clamp(maxDelta / 0.5, 0.0, 1.0);

  vec3 tint = vec3(0.753, 0.149, 0.827);
  if (lumaL + u_threshold < lumaR) {
    tint = vec3(0.863, 0.149, 0.149);
  } else if (lumaR + u_threshold < lumaL) {
    tint = vec3(0.086, 0.639, 0.290);
  }

  gl_FragColor = vec4(mix(vec3(1.0), tint, strength), 1.0);
}
`;

/** Inputs needed to paint a GPU visual diff onto an HTMLCanvasElement. */
export interface WebGlDiffDrawInput {
  leftPixels: Uint8Array;
  leftWidth: number;
  leftHeight: number;
  rightPixels: Uint8Array;
  rightWidth: number;
  rightHeight: number;
  /** Per-channel tolerance in `[0, 255]`. */
  threshold: number;
}

/**
 * Compile a GLSL shader and verify its compile status.
 *
 * @param gl Active WebGL context.
 * @param type `gl.VERTEX_SHADER` or `gl.FRAGMENT_SHADER`.
 * @param source GLSL source code.
 * @returns Compiled shader handle, or `null` if compilation failed.
 */
function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Upload an RGBA pixel buffer to a `CLAMP_TO_EDGE` + `NEAREST` WebGL texture.
 *
 * @param gl Active WebGL context.
 * @param width Bitmap width in pixels.
 * @param height Bitmap height in pixels.
 * @param pixels RGBA bytes (`width * height * 4`).
 * @returns Allocated texture handle, or `null`.
 */
function uploadRgbaTexture(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
  pixels: Uint8Array,
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  );
  return tex;
}

/**
 * Attempt to render the per-pixel visual diff directly on the GPU via WebGL.
 *
 * @param canvas Target `<canvas>` element.
 * @param input Aligned left/right RGBA pixel buffers and threshold.
 * @returns True when GPU rendering succeeded.
 */
export function renderVisualDiffWebGl(
  canvas: HTMLCanvasElement,
  input: WebGlDiffDrawInput,
): boolean {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
  } catch {
    return false;
  }
  if (!gl) return false;

  const outWidth = Math.max(1, input.leftWidth, input.rightWidth);
  const outHeight = Math.max(1, input.leftHeight, input.rightHeight);
  canvas.width = outWidth;
  canvas.height = outHeight;

  const vs = compileShader(gl, gl.VERTEX_SHADER, DIFF_VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, DIFF_FRAGMENT_SHADER);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return false;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return false;
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return false;
  }

  const buffer = gl.createBuffer();
  const leftTex = uploadRgbaTexture(
    gl,
    input.leftWidth,
    input.leftHeight,
    input.leftPixels,
  );
  const rightTex = uploadRgbaTexture(
    gl,
    input.rightWidth,
    input.rightHeight,
    input.rightPixels,
  );

  if (!buffer || !leftTex || !rightTex) {
    if (buffer) gl.deleteBuffer(buffer);
    if (leftTex) gl.deleteTexture(leftTex);
    if (rightTex) gl.deleteTexture(rightTex);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return false;
  }

  try {
    gl.viewport(0, 0, outWidth, outHeight);
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const posLoc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, leftTex);
    gl.uniform1i(gl.getUniformLocation(program, "u_leftTex"), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rightTex);
    gl.uniform1i(gl.getUniformLocation(program, "u_rightTex"), 1);

    gl.uniform2f(
      gl.getUniformLocation(program, "u_leftUvScale"),
      input.leftWidth / outWidth,
      input.leftHeight / outHeight,
    );
    gl.uniform2f(
      gl.getUniformLocation(program, "u_rightUvScale"),
      input.rightWidth / outWidth,
      input.rightHeight / outHeight,
    );
    gl.uniform1f(
      gl.getUniformLocation(program, "u_threshold"),
      input.threshold / 255,
    );

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  } finally {
    gl.deleteBuffer(buffer);
    gl.deleteTexture(leftTex);
    gl.deleteTexture(rightTex);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  }
}
