/**
 * CRC-32 (ISO 3309 / ITU-T V.42), the checksum every ZIP entry carries.
 *
 * How the table method works: CRC-32 divides the data, seen as one long
 * binary polynomial, by the generator polynomial 0x04C11DB7 and keeps the
 * remainder. ZIP uses the "reflected" form (bits are processed least
 * significant first), where the generator is written 0xEDB88320. Dividing
 * bit by bit costs eight steps per byte; instead, the effect of every
 * possible byte (0-255) on the remainder is computed once into a 256-entry
 * table, and each data byte then costs one lookup, one shift and one XOR.
 * The register starts as all ones and is inverted at the end, as the
 * standard requires (so leading zero bytes still change the result).
 */

/** Remainder contribution of each possible byte value. */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    // Eight polynomial division steps, one per bit of the byte: when the
    // lowest bit is set, the reflected generator is subtracted (XOR).
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Compute the CRC-32 of some bytes, optionally continuing an earlier
 * checksum (so large data can be processed in chunks).
 *
 * @param bytes The data.
 * @param previous The CRC-32 of the data before `bytes` (0 to start).
 * @returns The checksum as an unsigned 32-bit integer.
 */
export function crc32(bytes: Uint8Array, previous = 0): number {
  // Undo the final inversion of the previous result to resume the register.
  let crc = ~previous >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    // The low byte of the register, mixed with the data byte, selects the
    // table entry; the rest of the register moves down by one byte.
    crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}
