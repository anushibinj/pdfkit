/**
 * CRC-32 as used by PNG chunks and ZIP entries (ISO 3309 / ITU-T V.42, the
 * same checksum as zlib's `crc32`). Pure and dependency-free.
 */

/**
 * The reflected IEEE polynomial x^32 + x^26 + ... + 1. "Reflected" means
 * the bits are processed least-significant first, which is why the
 * algorithm below shifts right instead of left.
 */
const POLYNOMIAL = 0xedb88320;

/**
 * Build the 256-entry lookup table, once per module load.
 *
 * Entry `n` is the CRC remainder of the single byte `n`: eight rounds of
 * "shift right one bit; if the bit that fell out was 1, XOR in the
 * polynomial". With the table, the main loop handles a whole byte per step
 * instead of a bit, which is about eight times faster.
 *
 * @returns The table.
 */
function buildTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const TABLE = buildTable();

/**
 * Compute (or continue) a CRC-32.
 *
 * The register starts as all ones and is inverted again at the end; both
 * are part of the standard. Passing the result of an earlier call as
 * `previous` continues the checksum over more data, so a large file can be
 * checksummed in pieces: `crc32(b, crc32(a))` equals `crc32(a + b)`.
 * `>>> 0` keeps every intermediate value an unsigned 32-bit integer
 * (JavaScript's bitwise operators otherwise produce signed results).
 *
 * @param bytes The data.
 * @param previous The CRC of the data before `bytes`, or 0 to start.
 * @returns The CRC-32 as an unsigned 32-bit integer.
 */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
