/**
 * A test double for the Emscripten runtime of the PDFium module, shared by
 * every PDFium-based tool's unit tests. Real behaviour is covered by the
 * integration tests, which run the actual WebAssembly build.
 */
import type { PdfiumRuntime } from "../runtime";

/**
 * A runtime with a bump allocator over a real byte array. Memory "grows" on
 * every allocation by swapping `HEAPU8` for a new, larger view, the way
 * Emscripten does, so code that holds on to an old view is caught.
 */
export class FakeRuntime implements PdfiumRuntime {
  HEAPU8 = new Uint8Array(64);
  private next = 8;
  readonly freed: number[] = [];
  readonly allocated: number[] = [];
  /** Size requested for each allocation, by address. */
  readonly sizes = new Map<number, number>();
  /** Every malloc and free in order, e.g. "free:12". */
  readonly log: string[] = [];
  /** Set to make the next allocations fail (malloc returns 0). */
  failAlloc = false;
  readonly floats = new Map<number, number>();
  readonly strings = new Map<number, string>();

  wasmExports = {
    malloc: (size: number) => {
      if (this.failAlloc) return 0;
      const ptr = this.next;
      this.next += size;
      const grown = new Uint8Array(this.next + 64);
      grown.set(this.HEAPU8);
      this.HEAPU8 = grown;
      this.allocated.push(ptr);
      this.sizes.set(ptr, size);
      this.log.push(`malloc:${ptr}`);
      return ptr;
    },
    free: (ptr: number) => {
      this.freed.push(ptr);
      this.log.push(`free:${ptr}`);
    },
  };

  stringToUTF16 = (text: string, ptr: number) => {
    this.strings.set(ptr, text);
    return text.length * 2;
  };

  /** Decodes real bytes from `HEAPU8` (UTF-16LE up to a 0 code unit). */
  UTF16ToString = (ptr: number) => {
    let text = "";
    for (let o = ptr; o + 1 < this.HEAPU8.length; o += 2) {
      const unit = this.HEAPU8[o] | (this.HEAPU8[o + 1] << 8);
      if (unit === 0) break;
      text += String.fromCharCode(unit);
    }
    return text;
  };

  /** Decodes real bytes from `HEAPU8` (UTF-8 up to a 0 byte). */
  UTF8ToString = (ptr: number) => {
    const end = this.HEAPU8.indexOf(0, ptr);
    return new TextDecoder().decode(
      this.HEAPU8.subarray(ptr, end < 0 ? undefined : end),
    );
  };

  /**
   * Write a string the way PDFium would, for `UTF16ToString` to read.
   *
   * @param ptr Where to write.
   * @param text The text, written as UTF-16LE plus a 0 terminator.
   */
  writeUtf16(ptr: number, text: string): void {
    for (let i = 0; i <= text.length; i++) {
      const unit = i < text.length ? text.charCodeAt(i) : 0;
      this.HEAPU8[ptr + i * 2] = unit & 0xff;
      this.HEAPU8[ptr + i * 2 + 1] = unit >> 8;
    }
  }

  setValue = (ptr: number, value: number) => {
    this.floats.set(ptr, value);
  };

  getValue = (ptr: number) => this.floats.get(ptr) ?? 0;

  /** @returns Allocations that were never freed. */
  leaks(): number[] {
    return this.allocated.filter((p) => !this.freed.includes(p));
  }
}
