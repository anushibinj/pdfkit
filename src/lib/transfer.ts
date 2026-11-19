/**
 * Return an `ArrayBuffer` holding exactly the bytes of `bytes`.
 *
 * `postMessage` transfers whole `ArrayBuffer`s, not views. If the view covers
 * its entire buffer, that buffer is handed over as-is (no copy). If it is a
 * window into a bigger buffer (for example a slice of WebAssembly memory),
 * transferring the whole buffer would send unrelated bytes and detach memory
 * the engine still needs, so the window is copied into a new buffer first.
 *
 * @param bytes A byte view.
 * @returns A buffer that can be safely transferred.
 */
export function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  const whole =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  return whole
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);
}
