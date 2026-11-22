// @vitest-environment node
import { crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ZipLimitError,
  centralHeader,
  checkEntryName,
  createStoredZip,
  dosDateTime,
  endRecord,
  localHeader,
  type ZipRecord,
} from "./stored-zip";

const utf8 = (text: string) => new TextEncoder().encode(text);

/** A parsed entry, read the way unzip tools do: from the end record. */
interface ReadEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  flags: number;
  method: number;
  time: number;
  date: number;
}

/**
 * Independent reader for the archives under test: finds the end record,
 * walks the central directory, follows each offset to its local header and
 * checks that the two headers agree.
 */
function readZip(bytes: Uint8Array): ReadEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(count);
  const dirSize = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  expect(at + dirSize).toBe(end);
  const entries: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    );
    const size = view.getUint32(at + 24, true);
    const crc = view.getUint32(at + 16, true);
    const local = view.getUint32(at + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    // The local header repeats the shared fields byte for byte.
    expect(bytes.subarray(local + 4, local + 30)).toEqual(
      bytes.subarray(at + 6, at + 32),
    );
    const dataStart = local + 30 + nameLength;
    entries.push({
      name,
      data: bytes.subarray(dataStart, dataStart + size),
      crc,
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      time: view.getUint16(at + 12, true),
      date: view.getUint16(at + 14, true),
    });
    at += 46 + nameLength;
  }
  return entries;
}

describe("dosDateTime", () => {
  it("packs local date and time with two-second precision", () => {
    const { time, date } = dosDateTime(new Date(2026, 10, 20, 13, 45, 31));
    expect(time >> 11).toBe(13);
    expect((time >> 5) & 0x3f).toBe(45);
    expect(time & 0x1f).toBe(15); // 31 s -> 15 two-second units
    expect(date >> 9).toBe(2026 - 1980);
    expect((date >> 5) & 0xf).toBe(11);
    expect(date & 0x1f).toBe(20);
  });

  it("clamps dates outside 1980-2107", () => {
    expect(dosDateTime(new Date(1970, 0, 1))).toEqual({
      time: 0,
      date: (1 << 5) | 1,
    });
    const late = dosDateTime(new Date(2200, 5, 5));
    expect(late.date >> 9).toBe(127);
    expect((late.date >> 5) & 0xf).toBe(12);
    expect(late.date & 0x1f).toBe(31);
  });
});

describe("checkEntryName", () => {
  it.each(["page-01.png", "images/a.jpg", "ünïcode ✓.png"])(
    "accepts %j",
    (name) => {
      expect(() => checkEntryName(name)).not.toThrow();
    },
  );

  it.each([
    "",
    "/etc/passwd",
    "a\\b.png",
    "../x.png",
    "a/../../b",
    "a\u0000b",
    "a\nb",
  ])("refuses %j", (name) => {
    expect(() => checkEntryName(name)).toThrow(/Unsafe file name/);
  });
});

describe("record builders", () => {
  const record: ZipRecord = {
    name: utf8("a.png"),
    crc: 0x12345678,
    size: 9,
    offset: 77,
  };
  const stamp = { time: 0x1234, date: 0x5678 };

  it("localHeader writes signature, UTF-8 flag, stored method, sizes and name", () => {
    const bytes = localHeader(record, stamp);
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(30 + 5);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(4, true)).toBe(20);
    expect(view.getUint16(6, true)).toBe(0x0800);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint16(10, true)).toBe(0x1234);
    expect(view.getUint16(12, true)).toBe(0x5678);
    expect(view.getUint32(14, true)).toBe(0x12345678);
    expect(view.getUint32(18, true)).toBe(9);
    expect(view.getUint32(22, true)).toBe(9);
    expect(view.getUint16(26, true)).toBe(5);
    expect(view.getUint16(28, true)).toBe(0);
    expect(new TextDecoder().decode(bytes.subarray(30))).toBe("a.png");
  });

  it("centralHeader adds version made by and the local header offset", () => {
    const bytes = centralHeader(record, stamp);
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(46 + 5);
    expect(view.getUint32(0, true)).toBe(0x02014b50);
    expect(view.getUint16(4, true)).toBe(20);
    expect(view.getUint32(16, true)).toBe(0x12345678);
    expect(view.getUint32(38, true)).toBe(0); // external attributes
    expect(view.getUint32(42, true)).toBe(77);
    expect(new TextDecoder().decode(bytes.subarray(46))).toBe("a.png");
  });

  it("endRecord counts entries and locates the directory", () => {
    const view = new DataView(endRecord(3, 150, 1000).buffer);
    expect(view.getUint32(0, true)).toBe(0x06054b50);
    expect(view.getUint16(8, true)).toBe(3);
    expect(view.getUint16(10, true)).toBe(3);
    expect(view.getUint32(12, true)).toBe(150);
    expect(view.getUint32(16, true)).toBe(1000);
    expect(view.getUint16(20, true)).toBe(0);
  });
});

describe("createStoredZip", () => {
  it("stores every entry unchanged, with correct CRCs, in order", async () => {
    const first = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff);
    const second = utf8("second file ✓");
    const zip = await createStoredZip(
      [
        { name: "one.png", data: new Blob([first]) },
        { name: "folder/two ✓.jpg", data: new Blob([second]) },
      ],
      new Date(2026, 0, 2, 3, 4, 6),
    );
    expect(zip.type).toBe("application/zip");
    const entries = readZip(new Uint8Array(await zip.arrayBuffer()));
    expect(entries.map((e) => e.name)).toEqual(["one.png", "folder/two ✓.jpg"]);
    expect(entries[0].data).toEqual(first);
    expect(entries[1].data).toEqual(second);
    expect(entries[0].crc).toBe(zlibCrc32(first));
    expect(entries[1].crc).toBe(zlibCrc32(second));
    for (const e of entries) {
      expect(e.method).toBe(0);
      expect(e.flags).toBe(0x0800);
      expect(e.date >> 9).toBe(2026 - 1980);
      expect(e.time & 0x1f).toBe(3);
    }
  });

  it("writes a valid empty archive", async () => {
    const zip = await createStoredZip([]);
    expect(zip.size).toBe(22);
    expect(readZip(new Uint8Array(await zip.arrayBuffer()))).toEqual([]);
  });

  it("refuses duplicate and unsafe names", async () => {
    const data = new Blob(["x"]);
    await expect(
      createStoredZip([
        { name: "a.png", data },
        { name: "a.png", data },
      ]),
    ).rejects.toThrow(/Duplicate/);
    await expect(createStoredZip([{ name: "../a.png", data }])).rejects.toThrow(
      /Unsafe/,
    );
  });

  it("refuses archives that would need ZIP64", async () => {
    const data = new Blob(["x"]);
    // 0xFFFF entries: that count would read as "ZIP64" in the end record.
    const many = Array.from({ length: 0xffff }, (_, i) => ({
      name: `${i}.png`,
      data,
    }));
    await expect(createStoredZip(many)).rejects.toBeInstanceOf(ZipLimitError);
    // A stand-in reporting a 4 GiB size: refused before it is read.
    const huge = {
      size: 2 ** 32,
      arrayBuffer: () => Promise.reject(),
    } as unknown as Blob;
    await expect(
      createStoredZip([{ name: "huge.png", data: huge }]),
    ).rejects.toThrow(/larger than 4 GB/);
  });
});
