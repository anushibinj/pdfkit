import type { PdfiumRuntime } from "./runtime";

/**
 * Allocates, fills and reads WebAssembly memory for PDFium calls.
 *
 * PDFium is C++: it cannot see JavaScript strings or arrays, only addresses
 * inside its own linear memory. Every argument that is not a plain number
 * (file bytes, UTF-16 text, float rectangles, index lists) has to be copied
 * into memory obtained from its `malloc` and released with its `free`.
 * Nothing is garbage collected there, so each allocation has an owner who
 * frees it; {@link WasmHeap.using} makes that owner a `finally` block.
 */
export class WasmHeap {
  /** @param runtime The Emscripten runtime of the PDFium module. */
  constructor(private readonly runtime: PdfiumRuntime) {}

  /**
   * Reserve memory.
   *
   * `malloc` returns 0 instead of throwing when the memory cannot grow. That
   * is turned into a `RangeError` here, which the worker classifies as "out
   * of memory" (see `isOutOfMemory`), instead of letting PDFium write to
   * address 0.
   *
   * @param size Bytes needed (0 is rounded up to 1 so the pointer is unique).
   * @returns The address of the new block.
   * @throws {RangeError} When the allocation fails.
   */
  alloc(size: number): number {
    const ptr = this.runtime.wasmExports.malloc(Math.max(1, size));
    if (!ptr)
      throw new RangeError("out of memory: WebAssembly allocation failed");
    return ptr;
  }

  /**
   * Release memory from {@link alloc}. Ignores 0, like C's `free(NULL)`.
   *
   * @param ptr The block's address.
   */
  free(ptr: number): void {
    if (ptr) this.runtime.wasmExports.free(ptr);
  }

  /**
   * Run `fn` with a block of memory and free the block afterwards, whether
   * `fn` returns or throws.
   *
   * @param ptr An address from one of the allocating methods.
   * @param fn Uses the memory.
   * @returns What `fn` returns.
   */
  using<T>(ptr: number, fn: (ptr: number) => T): T {
    try {
      return fn(ptr);
    } finally {
      this.free(ptr);
    }
  }

  /**
   * Copy bytes into a new block.
   *
   * `HEAPU8` is read after `alloc`, not before: allocating may grow the
   * memory, which replaces the view, and writing through an old view would
   * write into a detached buffer and be lost.
   *
   * @param bytes Data to copy.
   * @returns The block's address (owned by the caller).
   */
  copyIn(bytes: Uint8Array): number {
    const ptr = this.alloc(bytes.length);
    this.runtime.HEAPU8.set(bytes, ptr);
    return ptr;
  }

  /**
   * Copy bytes out of WebAssembly memory into a new JavaScript array.
   * `slice` (not `subarray`) so the result stays valid after the block is
   * freed or the memory grows.
   *
   * @param ptr Start address.
   * @param length Number of bytes.
   * @returns A copy of the bytes.
   */
  copyOut(ptr: number, length: number): Uint8Array {
    return this.runtime.HEAPU8.slice(ptr, ptr + length);
  }

  /**
   * Write text as a zero-terminated UTF-16LE string (PDFium's
   * `FPDF_WIDESTRING`). A JavaScript string's `length` is already its number
   * of UTF-16 code units, so it needs `length * 2` bytes plus 2 for the
   * terminator.
   *
   * @param text The text.
   * @returns The string's address (owned by the caller).
   */
  utf16(text: string): number {
    const bytes = (text.length + 1) * 2;
    const ptr = this.alloc(bytes);
    this.runtime.stringToUTF16(text, ptr, bytes);
    return ptr;
  }

  /**
   * Write 32-bit floats, e.g. an `FS_RECTF` (left, top, right, bottom).
   *
   * @param values The numbers.
   * @returns The array's address (owned by the caller).
   */
  floats(values: readonly number[]): number {
    const ptr = this.alloc(values.length * 4);
    values.forEach((v, i) => this.runtime.setValue(ptr + i * 4, v, "float"));
    return ptr;
  }

  /**
   * Write 32-bit integers, e.g. a page index list for `FPDF_MovePages`.
   *
   * @param values The integers.
   * @returns The array's address (owned by the caller).
   */
  ints(values: readonly number[]): number {
    const ptr = this.alloc(values.length * 4);
    values.forEach((v, i) => this.runtime.setValue(ptr + i * 4, v, "i32"));
    return ptr;
  }

  /**
   * Read 32-bit signed integers written by PDFium, e.g. colour channels.
   *
   * @param ptr Start address.
   * @param count How many integers.
   * @returns The values.
   */
  readInts(ptr: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) =>
      Number(this.runtime.getValue(ptr + i * 4, "i32")),
    );
  }

  /**
   * Read 64-bit floats (C `double`) written by PDFium, e.g. a character's
   * origin.
   *
   * @param ptr Start address.
   * @param count How many doubles.
   * @returns The values.
   */
  readDoubles(ptr: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) =>
      Number(this.runtime.getValue(ptr + i * 8, "double")),
    );
  }

  /**
   * Read a string through PDFium's two-call convention.
   *
   * Functions like `FPDFFont_GetBaseFontName` or `FPDFTextObj_GetText` take
   * a buffer and its length in bytes, and return the length they need
   * (terminator included). Called with no buffer they only report that
   * length. So: ask for the length, allocate it, call again to fill it,
   * then decode the bytes and free them.
   *
   * @param fill Calls PDFium with (buffer, byteLength) and returns the
   *   required length in bytes; 0 means "no string".
   * @param encoding How PDFium encodes this string.
   * @returns The decoded string ("" when PDFium has none).
   */
  readString(
    fill: (buffer: number, byteLength: number) => number,
    encoding: "utf8" | "utf16",
  ): string {
    const length = fill(0, 0);
    // A UTF-16 terminator alone is 2 bytes, a UTF-8 one is 1.
    if (length <= (encoding === "utf16" ? 2 : 1)) return "";
    return this.using(this.alloc(length), (buffer) => {
      fill(buffer, length);
      return encoding === "utf16"
        ? this.runtime.UTF16ToString(buffer)
        : this.runtime.UTF8ToString(buffer);
    });
  }

  /**
   * Read 32-bit floats written by PDFium.
   *
   * @param ptr Start address.
   * @param count How many floats.
   * @returns The values.
   */
  readFloats(ptr: number, count: number): number[] {
    // "float" reads always give a number; Number() only narrows the type
    // (getValue can return a bigint for 64-bit integer reads).
    return Array.from({ length: count }, (_, i) =>
      Number(this.runtime.getValue(ptr + i * 4, "float")),
    );
  }
}
