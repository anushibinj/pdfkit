import { describe, expect, it, vi } from "vitest";
import { PdfOpenError } from "@/lib/pdfium/document";
import type { PageImageEntry } from "../engine/images-session";
import type { ImagesRequest } from "../messages";
import {
  createImagesHandler,
  handleRequest,
  stringList,
  toErrorResult,
  toWireEntries,
  type Session,
} from "./images-handler";

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    open: vi.fn(() => 4),
    renderPage: vi.fn(async (pageIndex: number) => ({
      pageIndex,
      width: 2,
      height: 1,
      dpi: 150,
      reduced: false,
      mimeType: "image/png" as const,
      bytes: new Uint8Array([1, 2, 3]),
    })),
    extractImages: vi.fn(async () => []),
    close: vi.fn(),
    ...overrides,
  };
}
const ctx = { progress: vi.fn() };
const open = (password?: string): ImagesRequest => ({
  op: "open",
  data: new ArrayBuffer(2),
  password,
});

describe("toErrorResult", () => {
  it("classifies memory exhaustion, traps and ordinary failures", () => {
    expect(toErrorResult(new RangeError("x")).reason).toBe("out-of-memory");
    const trap = toErrorResult(new WebAssembly.RuntimeError("unreachable"));
    expect(trap.reason).toBe("crashed");
    expect(trap.message).toContain("unreachable");
    expect(toErrorResult(new Error("Page 9 does not exist."))).toEqual({
      status: "error",
      reason: "failed",
      message: "Page 9 does not exist.",
    });
  });
});

describe("stringList", () => {
  it("keeps only strings of an array", () => {
    expect(stringList(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(stringList("a")).toEqual([]);
    expect(stringList(undefined)).toEqual([]);
  });
});

describe("toWireEntries", () => {
  it("moves image bytes into transferable buffers and passes the rest through", () => {
    const entries: PageImageEntry[] = [
      {
        kind: "image",
        key: "k1",
        width: 1,
        height: 1,
        mimeType: "image/png",
        method: "decoded",
        bytes: new Uint8Array([9, 8]),
      },
      { kind: "repeat", key: "k1" },
      { kind: "skipped", key: "k2", width: 5, height: 5, reason: "too large" },
    ];
    const { entries: wire, transfer } = toWireEntries(entries);
    expect(transfer).toHaveLength(1);
    expect(wire[0]).toMatchObject({
      kind: "image",
      key: "k1",
      data: transfer[0],
    });
    expect(wire[0]).not.toHaveProperty("bytes");
    expect(Array.from(new Uint8Array(transfer[0]))).toEqual([9, 8]);
    expect(wire.slice(1)).toEqual(entries.slice(1));
  });
});

describe("handleRequest", () => {
  it("opens with the password and reports the page count", async () => {
    const session = fakeSession();
    const { result } = await handleRequest(session, open("pw"));
    expect(result).toEqual({ status: "opened", pageCount: 4 });
    expect(session.open).toHaveBeenCalledWith(expect.any(Uint8Array), "pw");
  });

  it("splits password errors into required and wrong", async () => {
    const session = fakeSession({
      open: vi.fn(() => {
        throw new PdfOpenError("password");
      }),
    });
    expect((await handleRequest(session, open())).result).toEqual({
      status: "password-required",
    });
    expect((await handleRequest(session, open("nope"))).result).toEqual({
      status: "wrong-password",
    });
  });

  it("reports other open failures as messages", async () => {
    const damaged = fakeSession({
      open: vi.fn(() => {
        throw new PdfOpenError("format");
      }),
    });
    expect((await handleRequest(damaged, open())).result).toMatchObject({
      status: "error",
      reason: "failed",
      message: expect.stringMatching(/valid PDF/),
    });
    const oom = fakeSession({
      open: vi.fn(() => {
        throw new RangeError("out of memory");
      }),
    });
    expect((await handleRequest(oom, open())).result).toMatchObject({
      reason: "out-of-memory",
    });
  });

  it("treats a missing password as none", async () => {
    const session = fakeSession();
    await handleRequest(session, {
      op: "open",
      data: new ArrayBuffer(1),
      password: 42 as unknown as string,
    });
    expect(session.open).toHaveBeenCalledWith(expect.any(Uint8Array), "");
  });

  it("renders a page and transfers its file", async () => {
    const session = fakeSession();
    const options = { format: "png" as const, dpi: 150, quality: 0.9 };
    const { result, transfer } = await handleRequest(session, {
      op: "render-page",
      pageIndex: 2,
      options,
    });
    expect(session.renderPage).toHaveBeenCalledWith(2, options);
    expect(result).toMatchObject({
      status: "page",
      pageIndex: 2,
      width: 2,
      dpi: 150,
    });
    expect(result).not.toHaveProperty("bytes");
    expect(transfer).toHaveLength(1);
  });

  it("extracts images with the known keys sanitised", async () => {
    const session = fakeSession();
    const { result } = await handleRequest(session, {
      op: "extract-images",
      pageIndex: 1,
      knownKeys: ["a", 3] as unknown as string[],
    });
    expect(session.extractImages).toHaveBeenCalledWith(1, ["a"]);
    expect(result).toEqual({ status: "images", pageIndex: 1, entries: [] });
  });

  it("closes, and answers unknown requests with an error", async () => {
    const session = fakeSession();
    expect((await handleRequest(session, { op: "close" })).result).toEqual({
      status: "closed",
    });
    expect(session.close).toHaveBeenCalled();
    const unknown = { op: "explode" } as unknown as ImagesRequest;
    expect((await handleRequest(session, unknown)).result).toMatchObject({
      status: "error",
      message: "Unknown request.",
    });
  });
});

describe("createImagesHandler", () => {
  it("reports an engine that fails to load, except for close", async () => {
    const handler = createImagesHandler(async () => {
      throw new Error("offline");
    });
    expect((await handler(open(), ctx)).result).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: offline",
    });
    expect((await handler({ op: "close" }, ctx)).result).toEqual({
      status: "closed",
    });
  });

  it("turns exceptions into results instead of rejecting", async () => {
    const session = fakeSession({
      renderPage: vi.fn(async () => {
        throw new WebAssembly.RuntimeError("unreachable");
      }),
    });
    const handler = createImagesHandler(async () => session);
    const { result } = await handler(
      {
        op: "render-page",
        pageIndex: 0,
        options: { format: "png", dpi: 72, quality: 1 },
      },
      ctx,
    );
    expect(result).toMatchObject({ status: "error", reason: "crashed" });
  });

  it("runs requests one at a time, in order", async () => {
    const order: string[] = [];
    let finishExtract: () => void = () => {};
    const session = fakeSession({
      extractImages: vi.fn(async () => {
        order.push("extract start");
        await new Promise<void>((resolve) => (finishExtract = resolve));
        order.push("extract end");
        return [];
      }),
      close: vi.fn(() => {
        order.push("close");
      }),
    });
    const handler = createImagesHandler(async () => session);
    const extracting = handler(
      { op: "extract-images", pageIndex: 0, knownKeys: [] },
      ctx,
    );
    const closing = handler({ op: "close" }, ctx);
    // Let both requests get as far as they can.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(order).toEqual(["extract start"]);
    finishExtract();
    await Promise.all([extracting, closing]);
    expect(order).toEqual(["extract start", "extract end", "close"]);
  });
});
