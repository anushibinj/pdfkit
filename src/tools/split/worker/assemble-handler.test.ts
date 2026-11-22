import { describe, expect, it, vi } from "vitest";
import { crc32 } from "@/lib/crc32";
import { AssemblyError, WrongPasswordError } from "../engine/page-assembler";
import type { AssembleRequest } from "../messages";
import { createAssembleHandler, type AssemblerLike } from "./assemble-handler";

const request = (overrides: Partial<AssembleRequest> = {}): AssembleRequest => ({
  data: new Uint8Array([1, 2, 3]).buffer,
  password: "",
  pageCount: 3,
  outputs: [[0], [1, 2]],
  ...overrides,
});

/** Makes one file per output whose bytes are its pages plus 10. */
function fakeAssembler() {
  return {
    assemble: vi.fn<AssemblerLike["assemble"]>(
      (_source, _pw, _count, outputs, onProgress) => {
        outputs.forEach((_, i) => onProgress?.(i + 1, outputs.length));
        return {
          files: outputs.map((pages) => new Uint8Array(pages.map((p) => p + 10))),
          warnings: [],
        };
      },
    ),
  };
}

describe("createAssembleHandler", () => {
  it("builds the files, adds their CRC-32 and transfers them", async () => {
    const assembler = fakeAssembler();
    const progress = vi.fn();
    const out = await createAssembleHandler(async () => assembler)(request(), {
      progress,
    });
    expect(assembler.assemble).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "",
      3,
      [[0], [1, 2]],
      expect.any(Function),
    );
    expect(out.result.status).toBe("assembled");
    if (out.result.status !== "assembled") throw new Error("unreachable");
    const [first, second] = out.result.files;
    expect(Array.from(new Uint8Array(second.data))).toEqual([11, 12]);
    expect(first.crc32).toBe(crc32(new Uint8Array([10])));
    expect(out.transfer).toEqual([first.data, second.data]);
    expect(out.result.warnings).toBeUndefined();
    // progress climbs to 1 as files are made
    expect(progress.mock.calls.at(-1)?.[0]).toBe(1);
  });

  it("passes the password and joins warnings", async () => {
    const assembler = fakeAssembler();
    assembler.assemble.mockReturnValue({
      files: [new Uint8Array(1)],
      warnings: ["Repaired page 2", "Fixed xref"],
    });
    const out = await createAssembleHandler(async () => assembler)(
      request({ password: "pw", outputs: [[0]] }),
      { progress: vi.fn() },
    );
    expect(assembler.assemble.mock.calls[0][1]).toBe("pw");
    expect(out.result).toMatchObject({ warnings: "Repaired page 2 Fixed xref" });
  });

  it("reports an engine that cannot load", async () => {
    const out = await createAssembleHandler(async () => {
      throw new Error("Failed to fetch");
    })(request(), { progress: vi.fn() });
    expect(out.result).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: Failed to fetch",
    });
  });

  it.each([
    [{ data: "x" as unknown as ArrayBuffer }, "No file was received."],
    [{ outputs: [[5]] }, "File 1 lists a page that does not exist."],
    [{ pageCount: 0 }, "The page count is missing or not valid."],
  ])("refuses a bad request %#", async (overrides, message) => {
    const assembler = fakeAssembler();
    const out = await createAssembleHandler(async () => assembler)(
      request(overrides),
      { progress: vi.fn() },
    );
    expect(out.result).toEqual({ status: "error", reason: "failed", message });
    expect(assembler.assemble).not.toHaveBeenCalled();
  });

  it("maps a refused password and qpdf failures", async () => {
    const assembler = fakeAssembler();
    const handler = createAssembleHandler(async () => assembler);
    assembler.assemble.mockImplementationOnce(() => {
      throw new WrongPasswordError();
    });
    expect((await handler(request(), { progress: vi.fn() })).result).toEqual({
      status: "wrong-password",
    });
    assembler.assemble.mockImplementationOnce(() => {
      throw new AssemblyError("This does not look like a valid PDF file.");
    });
    expect((await handler(request(), { progress: vi.fn() })).result).toEqual({
      status: "error",
      reason: "failed",
      message: "This does not look like a valid PDF file.",
    });
  });

  it("asks for a fresh engine after a crash or running out of memory only", async () => {
    const assembler = fakeAssembler();
    const onEngineFailure = vi.fn();
    const handler = createAssembleHandler(async () => assembler, onEngineFailure);
    assembler.assemble.mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError("unreachable");
    });
    expect((await handler(request(), { progress: vi.fn() })).result).toMatchObject({
      reason: "crashed",
    });
    assembler.assemble.mockImplementationOnce(() => {
      throw new RangeError("Array buffer allocation failed");
    });
    expect((await handler(request(), { progress: vi.fn() })).result).toMatchObject({
      reason: "out-of-memory",
    });
    expect(onEngineFailure).toHaveBeenCalledTimes(2);
    assembler.assemble.mockImplementationOnce(() => {
      throw new Error("odd");
    });
    await handler(request(), { progress: vi.fn() });
    expect(onEngineFailure).toHaveBeenCalledTimes(2);
  });
});
