/**
 * A minimal ZIP writer for files that are already compressed (PNG, JPEG).
 *
 * Every entry is "stored" (compression method 0): its bytes are copied into
 * the archive as they are. Recompressing a PNG or JPEG gains almost nothing
 * and costs time, and storing lets the archive be assembled as a `Blob`
 * whose parts are the entries' own Blobs, so the image data is never copied
 * into one large buffer.
 *
 * Layout (PKWARE APPNOTE.TXT, section 4.3.6), all integers little-endian:
 *
 *   [local file header 1][data 1] ... [local file header n][data n]
 *   [central directory header 1] ... [central directory header n]
 *   [end of central directory record]
 *
 * The local header sits before each file's data; the central directory at
 * the end repeats it with the offset of each local header, and the end
 * record says where the central directory starts. Readers start from the
 * end record.
 *
 * ZIP64 is not written: an archive is refused (with {@link ZipLimitError})
 * if it would need it, i.e. more than 65,535 entries or any size or offset
 * of 4 GiB or more. In-browser outputs stay far below that.
 */
import { crc32 } from "@/lib/crc32";

/** One file to put in the archive. */
export interface ZipEntry {
  /** Path inside the archive, "/" separated, e.g. "report-page-01.png". */
  name: string;
  /** The file's bytes. */
  data: Blob;
}

/** The archive would exceed what a ZIP without ZIP64 can describe. */
export class ZipLimitError extends Error {
  /** @param message What limit was hit. */
  constructor(message: string) {
    super(message);
    this.name = "ZipLimitError";
  }
}

/** Signatures that start each record (APPNOTE 4.3.7, 4.3.12, 4.3.16). */
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
/** Fixed sizes of the records, before the file name. */
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
/** "Version needed to extract": 2.0, the baseline for stored entries. */
const VERSION = 20;
/** General purpose flag bit 11: the file name is UTF-8 (APPNOTE 4.4.4). */
const UTF8_NAMES = 0x0800;
/** Compression method 0: stored. */
const STORED = 0;
/** Largest value a 32-bit field can hold; 0xFFFFFFFF itself means "ZIP64". */
const MAX_32 = 0xfffffffe;
/** Largest entry count and name length a 16-bit field can hold. */
const MAX_16 = 0xffff;

/** An MS-DOS date and time, the timestamp format of ZIP headers. */
export interface DosDateTime {
  /** Bits 15-11 hours, 10-5 minutes, 4-0 seconds / 2. */
  time: number;
  /** Bits 15-9 years since 1980, 8-5 month (1-12), 4-0 day (1-31). */
  date: number;
}

/**
 * Convert a JavaScript date to the MS-DOS format used in ZIP headers.
 *
 * DOS timestamps are local time with two-second precision, and can only
 * express the years 1980 to 2107 (seven bits counted from 1980). Dates
 * outside that range are clamped to its ends instead of wrapping around to
 * a wrong year.
 *
 * @param value The moment to encode (read in local time).
 * @returns The packed time and date fields.
 */
export function dosDateTime(value: Date): DosDateTime {
  const year = value.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 }; // 1980-01-01 00:00
  if (year > 2107) {
    // 2107-12-31 23:59:58
    return {
      time: (23 << 11) | (59 << 5) | 29,
      date: (127 << 9) | (12 << 5) | 31,
    };
  }
  return {
    time:
      (value.getHours() << 11) |
      (value.getMinutes() << 5) |
      Math.floor(value.getSeconds() / 2),
    date:
      ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}

/**
 * Refuse names that could escape the extraction folder or that ZIP tools
 * read differently ("zip slip"): empty names, absolute paths, backslashes
 * (Windows tools treat them as separators), ".." segments, and control
 * characters.
 *
 * @param name The entry name.
 * @throws {Error} When the name is unsafe.
 */
export function checkEntryName(name: string): void {
  const bad = /[\u0000-\u001f\\]/.test(name);
  if (
    name === "" ||
    bad ||
    name.startsWith("/") ||
    name.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`Unsafe file name in archive: ${JSON.stringify(name)}`);
  }
}

/**
 * Read a Blob completely and compute its CRC-32.
 *
 * The bytes are only held for the duration of the checksum; the archive
 * reuses the Blob itself as its data part.
 *
 * @param blob The entry's data.
 * @returns The checksum.
 */
async function checksum(blob: Blob): Promise<number> {
  return crc32(new Uint8Array(await blob.arrayBuffer()));
}

/** What the headers say about one entry. */
export interface ZipRecord {
  /** The entry name, UTF-8 encoded. */
  name: Uint8Array;
  /** CRC-32 of the data. */
  crc: number;
  /** Data size in bytes (stored, so compressed and uncompressed alike). */
  size: number;
  /** Where the entry's local header starts in the archive. */
  offset: number;
}

/**
 * Fill the fields shared by the local and the central header, in the order
 * they appear in both (APPNOTE 4.3.7 and 4.3.12, from "version needed to
 * extract" to "extra field length").
 *
 * @param view Where to write.
 * @param at Byte offset of the "version needed to extract" field.
 * @param entry The entry.
 * @param stamp Its timestamp.
 */
function writeCommonFields(
  view: DataView,
  at: number,
  entry: ZipRecord,
  stamp: DosDateTime,
): void {
  view.setUint16(at, VERSION, true);
  view.setUint16(at + 2, UTF8_NAMES, true);
  view.setUint16(at + 4, STORED, true);
  view.setUint16(at + 6, stamp.time, true);
  view.setUint16(at + 8, stamp.date, true);
  view.setUint32(at + 10, entry.crc, true);
  view.setUint32(at + 14, entry.size, true); // compressed size
  view.setUint32(at + 18, entry.size, true); // uncompressed size (stored)
  view.setUint16(at + 22, entry.name.length, true);
  view.setUint16(at + 24, 0, true); // extra field length
}

/**
 * Build the local file header that precedes an entry's data.
 *
 * @param entry The entry.
 * @param stamp Its timestamp.
 * @returns The header bytes, file name included.
 */
export function localHeader(
  entry: ZipRecord,
  stamp: DosDateTime,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(LOCAL_HEADER_SIZE + entry.name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
  writeCommonFields(view, 4, entry, stamp);
  bytes.set(entry.name, LOCAL_HEADER_SIZE);
  return bytes;
}

/**
 * Build an entry's central directory header.
 *
 * It starts with "version made by" (here the same 2.0, host MS-DOS, so no
 * Unix permission bits are implied), then the fields it shares with the
 * local header, then comment length, disk number, internal and external
 * attributes (all 0) and the local header's offset.
 *
 * @param entry The entry.
 * @param stamp Its timestamp.
 * @returns The header bytes, file name included.
 */
export function centralHeader(
  entry: ZipRecord,
  stamp: DosDateTime,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(CENTRAL_HEADER_SIZE + entry.name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
  view.setUint16(4, VERSION, true); // version made by
  writeCommonFields(view, 6, entry, stamp);
  // 32: comment length, 34: disk number start, 36: internal attributes,
  // 38: external attributes; all zero (fresh Uint8Array).
  view.setUint32(42, entry.offset, true);
  bytes.set(entry.name, CENTRAL_HEADER_SIZE);
  return bytes;
}

/**
 * Build the end of central directory record.
 *
 * @param count Number of entries.
 * @param directorySize Total bytes of the central directory headers.
 * @param directoryOffset Where the central directory starts.
 * @returns The record (no archive comment).
 */
export function endRecord(
  count: number,
  directorySize: number,
  directoryOffset: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(END_RECORD_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  // 4: this disk, 6: disk with the directory; both 0 (single-file archive).
  view.setUint16(8, count, true); // entries on this disk
  view.setUint16(10, count, true); // entries in total
  view.setUint32(12, directorySize, true);
  view.setUint32(16, directoryOffset, true);
  // 20: comment length 0.
  return bytes;
}

/**
 * Assemble a ZIP archive of stored entries.
 *
 * How it works, step by step:
 * 1. Check the entry count and every name (unique, safe, short enough).
 * 2. For each entry, in order: compute its CRC-32 (reading the Blob once),
 *    write its local header followed by the Blob itself, and remember the
 *    header's offset. `offset` advances by header size plus data size, and
 *    is checked against the 32-bit limit before it is used.
 * 3. Write one central directory header per entry, then the end record
 *    pointing at the start of the central directory.
 * All timestamps are `modified`, so every entry shows the same date.
 *
 * @param entries The files, in archive order.
 * @param modified Timestamp for every entry (defaults to now).
 * @returns The archive.
 * @throws {ZipLimitError} When the archive would need ZIP64.
 * @throws {Error} For an unsafe or duplicate name.
 */
export async function createStoredZip(
  entries: readonly ZipEntry[],
  modified: Date = new Date(),
): Promise<Blob> {
  if (entries.length > MAX_16) {
    throw new ZipLimitError(`Too many files for one ZIP (${entries.length}).`);
  }
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  for (const { name } of entries) {
    checkEntryName(name);
    if (seen.has(name)) throw new Error(`Duplicate file name: ${name}`);
    seen.add(name);
    if (encoder.encode(name).length > MAX_16) {
      throw new ZipLimitError(`File name too long: ${name.slice(0, 40)}…`);
    }
  }

  const stamp = dosDateTime(modified);
  const parts: BlobPart[] = [];
  const written: ZipRecord[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const size = entry.data.size;
    if (size > MAX_32 || offset > MAX_32) {
      throw new ZipLimitError("The ZIP would be larger than 4 GB.");
    }
    const record: ZipRecord = {
      name,
      crc: await checksum(entry.data),
      size,
      offset,
    };
    const header = localHeader(record, stamp);
    parts.push(header, entry.data);
    written.push(record);
    offset += header.length + size;
  }

  const directoryOffset = offset;
  let directorySize = 0;
  for (const record of written) {
    const header = centralHeader(record, stamp);
    parts.push(header);
    directorySize += header.length;
  }
  if (directoryOffset > MAX_32 || directorySize > MAX_32) {
    throw new ZipLimitError("The ZIP would be larger than 4 GB.");
  }
  parts.push(endRecord(written.length, directorySize, directoryOffset));
  return new Blob(parts, { type: "application/zip" });
}
