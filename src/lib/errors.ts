/**
 * Error helpers shared by every tool's worker. Pure functions: no WASM, no DOM.
 */

/**
 * Messages that browsers and Emscripten/wasm-bindgen runtimes produce when a
 * WebAssembly instance cannot grow its memory any further. They differ per
 * engine (V8, SpiderMonkey, JavaScriptCore) and per toolchain, so we match a
 * small set of known phrasings instead of relying on one error type.
 */
const OOM_PATTERNS = [
  /out of memory/i,
  /memory access out of bounds/i,
  /Cannot enlarge memory/i,
  /Array buffer allocation failed/i,
  /Aborted\(.*(OOM|memory)/i,
];

/**
 * Decide whether a thrown value means "the browser ran out of memory".
 *
 * A `RangeError` is treated as out-of-memory on its own because that is what
 * `new ArrayBuffer(n)` and `WebAssembly.Memory#grow` throw when an allocation
 * is refused. Anything else is matched by message text against
 * {@link OOM_PATTERNS}.
 *
 * @param err Any thrown value (an `Error`, a string, or something else).
 * @returns `true` when the failure looks like memory exhaustion.
 */
export function isOutOfMemory(err: unknown): boolean {
  if (err instanceof RangeError) return true;
  return OOM_PATTERNS.some((p) => p.test(errorMessage(err)));
}

/**
 * Read a human readable message from any thrown value.
 *
 * wasm-bindgen libraries throw plain strings (`throw "bad input"`), not
 * `Error` objects, so `err.message` alone would be `undefined` for them.
 *
 * @param err Any thrown value.
 * @returns The `Error#message`, or the value converted with `String()`.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
