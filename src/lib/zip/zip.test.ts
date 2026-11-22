import { describe, expect, it } from "vitest";
import { crc32 } from "@/lib/crc32";
import {
  ZipError,
  assertSafeEntryName,
  blobZipEntry,
  createZip,
  toDosDateTime,
  type ZipEntry,
} from "./zip";

const bytes = (text: string) => new TextEncoder().encode(text);
const buffer = (text: string) => bytes(text).buffer as ArrayBuffer;

/** Read a Blob's bytes (via FileReader, which jsdom implements). */
function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * A small ZIP reader for the tests: starts from the end record, walks the
 * central directory, and reads each file through its local header, the way
 * unzip tools do. Checks the signatures on the way.
 */
function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(count);
  const centralSize = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  expect(at + centralSize).toBe(end);
  const decoder = new TextDecoder();
  const files = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    // The local header must agree with the central entry.
    expect(view.getUint32(localAt, true)).toBe(0x04034b50);
    expect(view.getUint32(localAt + 14, true)).toBe(crc);
    expect(view.getUint32(localAt + 22, true)).toBe(size);
    const localNameLength = view.getUint16(localAt + 26, true);
    const dataAt =
      localAt + 30 + localNameLength + view.getUint16(localAt + 28, true);
    const data = zip.slice(dataAt, dataAt + size);
    files.push({ name, flags, method, time, date, crc, data });
    at += 46 + nameLength;
  }
  return files;
}

describe("toDosDateTime", () => {
  it("packs local date and time into the MS-DOS fields", () => {
    const { time, date } = toDosDateTime(new Date(2026, 10, 21, 14, 35, 59));
    expect(time).toBe((14 << 11) | (35 << 5) | 29);
    expect(date).toBe(((2026 - 1980) << 9) | (11 << 5) | 21);
  });

  it("clamps years outside 1980-2107", () => {
    expect(toDosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0);
    expect(toDosDateTime(new Date(2200, 0, 1)).date >> 9).toBe(127);
  });
});

describe("assertSafeEntryName", () => {
  it.each(["a.pdf", "folder/a.pdf", "über (2).pdf"])("accepts %j", (name) => {
    expect(() => assertSafeEntryName(name)).not.toThrow();
  });

  it.each(["", "/abs.pdf", "../up.pdf", "a/../b.pdf", "a\\b.pdf", "a//b.pdf"])(
    "rejects %j",
    (name) => {
      expect(() => assertSafeEntryName(name)).toThrow(ZipError);
    },
  );

  it("rejects names longer than the 16-bit length field", () => {
    expect(() => assertSafeEntryName("a".repeat(65_536))).toThrow(/too long/);
  });
});

describe("createZip", () => {
  const modified = new Date(2026, 10, 21, 9, 30, 0);

  it("writes stored entries that a reader can list and extract", async () => {
    const entries: ZipEntry[] = [
      { name: "one.pdf", data: buffer("%PDF-1 first") },
      { name: "two (2).pdf", data: buffer("%PDF-2 second file") },
    ];
    const blob = createZip(entries, modified);
    expect(blob.type).toBe("application/zip");
    const files = readZip(await readBlob(blob));
    expect(files.map((f) => f.name)).toEqual(["one.pdf", "two (2).pdf"]);
    for (const [i, file] of files.entries()) {
      // Every entry here holds an ArrayBuffer.
      const original = new Uint8Array(entries[i].data as ArrayBuffer);
      expect(Array.from(file.data)).toEqual(Array.from(original));
      expect(file.crc).toBe(crc32(original));
      expect(file.method).toBe(0);
      expect(file.flags).toBe(0x0800);
      expect(file.date).toBe(toDosDateTime(modified).date);
      expect(file.time).toBe(toDosDateTime(modified).time);
    }
  });

  it("stores UTF-8 names as UTF-8", async () => {
    const files = readZip(
      await readBlob(
        createZip([{ name: "résumé.pdf", data: buffer("x") }], modified),
      ),
    );
    expect(files[0].name).toBe("résumé.pdf");
  });

  it("uses a CRC-32 given by the caller", async () => {
    const files = readZip(
      await readBlob(
        createZip(
          [{ name: "a.pdf", data: buffer("abc"), crc32: 1234 }],
          modified,
        ),
      ),
    );
    expect(files[0].crc).toBe(1234);
  });

  it("writes a valid empty archive", async () => {
    const zip = await readBlob(createZip([], modified));
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  it("refuses repeated and unsafe names", () => {
    const data = buffer("x");
    expect(() =>
      createZip(
        [
          { name: "a.pdf", data },
          { name: "a.pdf", data },
        ],
        modified,
      ),
    ).toThrow(/appears twice/);
    expect(() => createZip([{ name: "../a.pdf", data }], modified)).toThrow(
      ZipError,
    );
  });

  it("refuses more files than the format can count", () => {
    const data = new ArrayBuffer(0);
    // 0xFFFF entries: that count would read as "ZIP64" in the end record.
    const entries = Array.from({ length: 0xffff }, (_, i) => ({
      name: `${i}.pdf`,
      data,
      crc32: 0,
    }));
    expect(() => createZip(entries, modified)).toThrow(/65,534/);
  });

  it("stores Blob entries as they are, with the given CRC-32", async () => {
    const bytes = new TextEncoder().encode("image bytes");
    const blob = new Blob([bytes]);
    const entry = await blobZipEntry("page-01.png", blob);
    expect(entry).toEqual({
      name: "page-01.png",
      data: blob,
      crc32: crc32(bytes),
    });
    const zip = createZip(
      [entry, { name: "b.pdf", data: new Uint8Array([7]).buffer }],
      modified,
    );
    const archive = new Uint8Array(await zip.arrayBuffer());
    // The local header's CRC and size, then the Blob's bytes right after
    // the header and name (30 + 11 bytes).
    const view = new DataView(archive.buffer);
    expect(view.getUint32(14, true)).toBe(crc32(bytes));
    expect(view.getUint32(18, true)).toBe(bytes.length);
    expect(Array.from(archive.subarray(41, 41 + bytes.length))).toEqual(
      Array.from(bytes),
    );
  });

  it("refuses a file over 4 GB without reading it", () => {
    // A fake buffer: only its size is looked at before the limit check.
    const huge = { byteLength: 2 ** 32 } as ArrayBuffer;
    expect(() =>
      createZip([{ name: "big.pdf", data: huge, crc32: 0 }], modified),
    ).toThrow(/more than 4 GB/);
  });
});
