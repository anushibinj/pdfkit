import { describe, expect, it } from "vitest";
import { FakeRuntime } from "./test-utils/fake-pdfium-core";
import { WasmHeap } from "./wasm-heap";

describe("WasmHeap", () => {
  it("alloc returns a pointer and turns malloc failure into a RangeError", () => {
    const runtime = new FakeRuntime();
    const heap = new WasmHeap(runtime);
    expect(heap.alloc(0)).toBeGreaterThan(0);
    runtime.failAlloc = true;
    expect(() => heap.alloc(10)).toThrow(RangeError);
  });

  it("free releases real pointers and ignores 0", () => {
    const runtime = new FakeRuntime();
    const heap = new WasmHeap(runtime);
    heap.free(0);
    heap.free(42);
    expect(runtime.freed).toEqual([42]);
  });

  it("using frees the block after success and after failure", () => {
    const runtime = new FakeRuntime();
    const heap = new WasmHeap(runtime);
    expect(heap.using(heap.alloc(4), (p) => p > 0)).toBe(true);
    expect(() =>
      heap.using(heap.alloc(4), () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(runtime.leaks()).toEqual([]);
  });

  it("copyIn writes through the view that exists after allocating", () => {
    // FakeRuntime replaces HEAPU8 on every malloc, like memory growth does.
    const runtime = new FakeRuntime();
    const heap = new WasmHeap(runtime);
    const ptr = heap.copyIn(new Uint8Array([7, 8, 9]));
    expect(Array.from(runtime.HEAPU8.subarray(ptr, ptr + 3))).toEqual([
      7, 8, 9,
    ]);
  });

  it("copyOut returns an independent copy", () => {
    const runtime = new FakeRuntime();
    const heap = new WasmHeap(runtime);
    const ptr = heap.copyIn(new Uint8Array([1, 2]));
    const out = heap.copyOut(ptr, 2);
    runtime.HEAPU8[ptr] = 99;
    expect(Array.from(out)).toEqual([1, 2]);
  });

  it("utf16 reserves two bytes per code unit plus a terminator", () => {
    const runtime = new FakeRuntime();
    const heap = new WasmHeap(runtime);
    const ptr = heap.utf16("héllo");
    expect(runtime.strings.get(ptr)).toBe("héllo");
    expect(runtime.sizes.get(ptr)).toBe(12);
  });

  it("floats, ints and readFloats store numbers four bytes apart", () => {
    const runtime = new FakeRuntime();
    const heap = new WasmHeap(runtime);
    const f = heap.floats([1.5, 2.5]);
    expect(heap.readFloats(f, 2)).toEqual([1.5, 2.5]);
    const i = heap.ints([3, 4, 5]);
    expect([
      runtime.floats.get(i),
      runtime.floats.get(i + 4),
      runtime.floats.get(i + 8),
    ]).toEqual([3, 4, 5]);
  });
  it("readInts reads 32-bit integers", () => {
    const runtime = new FakeRuntime();
    const heap = new WasmHeap(runtime);
    runtime.setValue(40, 255);
    runtime.setValue(44, -3);
    expect(heap.readInts(40, 3)).toEqual([255, -3, 0]);
  });

  it("readDoubles reads 8-byte floats", () => {
    const runtime = new FakeRuntime();
    const heap = new WasmHeap(runtime);
    runtime.setValue(80, 1.5);
    runtime.setValue(88, -2.25);
    expect(heap.readDoubles(80, 2)).toEqual([1.5, -2.25]);
  });

  describe("readString", () => {
    it("asks for the length, fills a block that size, decodes and frees it", () => {
      const runtime = new FakeRuntime();
      const heap = new WasmHeap(runtime);
      const calls: [number, number][] = [];
      const text = heap.readString((buffer, length) => {
        calls.push([buffer, length]);
        if (buffer) runtime.writeUtf16(buffer, "Héllo");
        return 12; // 5 code units + terminator, 2 bytes each
      }, "utf16");
      expect(text).toBe("Héllo");
      expect(calls[0]).toEqual([0, 0]);
      expect(calls[1][1]).toBe(12);
      expect(runtime.sizes.get(calls[1][0])).toBe(12);
      expect(runtime.leaks()).toEqual([]);
    });

    it("decodes UTF-8", () => {
      const runtime = new FakeRuntime();
      const heap = new WasmHeap(runtime);
      const bytes = new TextEncoder().encode("DejaVuSans-Bold\0");
      const text = heap.readString((buffer) => {
        if (buffer) runtime.HEAPU8.set(bytes, buffer);
        return bytes.length;
      }, "utf8");
      expect(text).toBe("DejaVuSans-Bold");
    });

    it.each([
      [0, "utf16"],
      [2, "utf16"],
      [1, "utf8"],
    ] as const)(
      "returns an empty string without allocating for length %i (%s)",
      (length, encoding) => {
        const runtime = new FakeRuntime();
        const heap = new WasmHeap(runtime);
        expect(heap.readString(() => length, encoding)).toBe("");
        expect(runtime.allocated).toEqual([]);
      },
    );

    it("frees the block when filling throws", () => {
      const runtime = new FakeRuntime();
      const heap = new WasmHeap(runtime);
      expect(() =>
        heap.readString((buffer) => {
          if (buffer) throw new Error("boom");
          return 10;
        }, "utf8"),
      ).toThrow("boom");
      expect(runtime.leaks()).toEqual([]);
    });
  });
});
