import { crc32 } from "@/lib/crc32";

/**
 * A minimal ZIP writer: files are stored, not compressed.
 *
 * Why stored: PDF content is already compressed inside the file (images,
 * fonts and page streams use Flate or JPEG), so deflating it again would
 * cost time for little gain, and storing keeps this writer small enough to
 * verify byte by byte against the specification (PKWARE APPNOTE.TXT, 4.3).
 *
 * Layout of the archive this writes:
 *
 *   [local header 1][file 1 bytes][local header 2][file 2 bytes]...
 *   [central directory entry 1][central directory entry 2]...
 *   [end of central directory record]
 *
 * Each local header and central directory entry repeat the same facts
 * (name, CRC-32, sizes, date); the central entry also records where its
 * local header starts, and the end record says where the central directory
 * starts. Unzip tools read the end record first and work backwards.
 *
 * The plain (non-ZIP64) format stores sizes and offsets in 32 bits and the
 * entry count in 16 bits, so it is limited to 4 GiB and 65,534 files (an
 * all-ones count, 0xFFFF, would tell readers to look for a ZIP64 record,
 * APPNOTE 4.4.1.4, which this writer does not write). This
 * writer checks those limits and refuses instead of writing a corrupt file.
 */

/** One file to put in the archive. */
export type ZipEntry =
  | {
      /** Path inside the archive, e.g. "report-page-1.pdf". */
      name: string;
      data: ArrayBuffer;
      /** CRC-32 of `data`, when already known; computed otherwise. */
      crc32?: number;
    }
  | {
      /** Path inside the archive, e.g. "report-page-01.png". */
      name: string;
      /**
       * Data already held in a Blob (for example an image a worker
       * produced). It becomes part of the archive as is, never copied.
       */
      data: Blob;
      /** CRC-32 of `data`: a Blob cannot be read synchronously. */
      crc32: number;
    };

/**
 * Make a ZIP entry from a Blob, computing its CRC-32.
 *
 * The Blob is read once for the checksum; the bytes are dropped afterwards
 * and the archive uses the Blob itself.
 *
 * @param name Path inside the archive.
 * @param data The file's contents.
 * @returns The entry, ready for {@link createZip}.
 */
export async function blobZipEntry(
  name: string,
  data: Blob,
): Promise<ZipEntry> {
  return { name, data, crc32: crc32(new Uint8Array(await data.arrayBuffer())) };
}

/** The archive cannot be written (a limit of the format, or a bad name). */
export class ZipError extends Error {
  /** @param message What is wrong, for the person. */
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** "Version needed to extract" 2.0: the baseline every unzip tool supports. */
const VERSION = 20;
/** General purpose flag bit 11: file names are UTF-8. */
const UTF8_NAMES = 0x0800;
/** Compression method 0: stored. */
const STORED = 0;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

/**
 * Convert a date to the MS-DOS date and time fields ZIP uses.
 *
 * Time: bits 15-11 hour, 10-5 minute, 4-0 seconds divided by two (DOS
 * time has a two-second resolution). Date: bits 15-9 years since 1980,
 * 8-5 month (1-12), 4-0 day. The year is clamped to 1980-2107, the range
 * the 7-bit field can hold. Local time is used, as unzip tools expect.
 *
 * @param date The modification date.
 * @returns The two 16-bit fields.
 */
export function toDosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Check that a name is a plain relative file name that cannot escape the
 * folder it is extracted into ("zip slip"): not empty, no leading slash,
 * no backslash (Windows tools treat it as a separator), no ".." segment.
 *
 * @param name The entry name.
 * @throws {ZipError} When the name is unsafe or too long.
 */
export function assertSafeEntryName(name: string): void {
  const segments = name.split("/");
  if (
    name === "" ||
    name.startsWith("/") ||
    name.includes("\\") ||
    segments.some((s) => s === ".." || s === "")
  ) {
    throw new ZipError(`"${name}" is not a safe file name for a ZIP archive.`);
  }
  if (new TextEncoder().encode(name).length > MAX_U16) {
    throw new ZipError("A file name is too long for a ZIP archive.");
  }
}

/**
 * Build a ZIP archive.
 *
 * The file bytes are not copied into one big buffer: the result is a Blob
 * made of the small headers plus the original buffers, so building a
 * 200 MB archive does not need another 200 MB of JavaScript memory.
 *
 * @param entries The files, in archive order. Names must be unique.
 * @param modified The modification date recorded for every file.
 * @returns The archive.
 * @throws {ZipError} On unsafe or repeated names, or beyond the format's
 *   limits (65,534 files, 4 GiB).
 */
export function createZip(entries: readonly ZipEntry[], modified: Date): Blob {
  // 0xFFFF in the end record's count means "see the ZIP64 record".
  if (entries.length >= MAX_U16) {
    throw new ZipError("Too many files for one ZIP archive (65,534 at most).");
  }
  const seen = new Set<string>();
  const { time, date } = toDosDateTime(modified);
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    assertSafeEntryName(entry.name);
    if (seen.has(entry.name)) {
      throw new ZipError(`"${entry.name}" appears twice in the archive.`);
    }
    seen.add(entry.name);
    const name = encoder.encode(entry.name);
    const size =
      entry.data instanceof Blob ? entry.data.size : entry.data.byteLength;
    const checksum =
      entry.crc32 ?? crc32(new Uint8Array(entry.data as ArrayBuffer));
    // The local header's own offset must fit in 32 bits, and so must the
    // end of this file's data (the next header or the central directory
    // starts there).
    if (size > MAX_U32 || offset + 30 + name.length + size > MAX_U32) {
      throw new ZipError(
        "The files add up to more than 4 GB, too much for one ZIP archive.",
      );
    }
    // The fields shared by the local header and the central entry, in the
    // order both use: flags, method, time, date, CRC, sizes, name length.
    const common = (view: DataView, at: number) => {
      view.setUint16(at, UTF8_NAMES, true);
      view.setUint16(at + 2, STORED, true);
      view.setUint16(at + 4, time, true);
      view.setUint16(at + 6, date, true);
      view.setUint32(at + 8, checksum, true);
      view.setUint32(at + 12, size, true); // compressed size (stored: same)
      view.setUint32(at + 16, size, true); // uncompressed size
      view.setUint16(at + 20, name.length, true);
      view.setUint16(at + 22, 0, true); // extra field length
    };

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_HEADER, true);
    lv.setUint16(4, VERSION, true);
    common(lv, 6);
    local.set(name, 30);

    const entryHeader = new Uint8Array(46 + name.length);
    const cv = new DataView(entryHeader.buffer);
    cv.setUint32(0, CENTRAL_HEADER, true);
    cv.setUint16(4, VERSION, true); // version made by: 2.0, MS-DOS attributes
    cv.setUint16(6, VERSION, true); // version needed to extract
    common(cv, 8);
    cv.setUint16(32, 0, true); // file comment length
    cv.setUint16(34, 0, true); // disk number where the file starts
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, offset, true); // where the local header starts
    entryHeader.set(name, 46);

    parts.push(local, entry.data);
    central.push(entryHeader);
    offset += local.length + size;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  if (offset + centralSize > MAX_U32) {
    throw new ZipError(
      "The files add up to more than 4 GB, too much for one ZIP archive.",
    );
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  ev.setUint16(4, 0, true); // number of this disk
  ev.setUint16(6, 0, true); // disk where the central directory starts
  ev.setUint16(8, entries.length, true); // entries on this disk
  ev.setUint16(10, entries.length, true); // entries in total
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // the central directory follows the data
  ev.setUint16(20, 0, true); // archive comment length

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
