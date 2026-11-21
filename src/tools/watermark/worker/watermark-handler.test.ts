import { describe, expect, it, vi } from "vitest";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import { DEFAULT_SETTINGS } from "../core/model";
import { InvalidSettingsError } from "../core/sanitize-settings";
import {
  createWatermarkHandler,
  handleRequest,
  toErrorResult,
  type Session,
} from "./watermark-handler";

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    open: vi.fn(() => 4),
    preview: vi.fn(() => ({ width: 2, height: 1, pixels: new Uint8Array(8) })),
    apply: vi.fn(() => new Uint8Array([37, 80])),
    close: vi.fn(),
    ...overrides,
  };
}

const ctx = { progress: vi.fn() };

describe("toErrorResult", () => {
  it("classifies memory exhaustion", () => {
    expect(toErrorResult(new RangeError("out of memory")).reason).toBe(
      "out-of-memory",
    );
  });

  it("classifies WebAssembly traps as crashes", () => {
    const result = toErrorResult(new WebAssembly.RuntimeError("unreachable"));
    expect(result.reason).toBe("crashed");
    expect(result.message).toContain("unreachable");
  });

  it("passes other errors through with their message", () => {
    expect(
      toErrorResult(new InvalidSettingsError("Type the watermark text.")),
    ).toEqual({
      status: "error",
      reason: "failed",
      message: "Type the watermark text.",
    });
  });
});

describe("handleRequest", () => {
  it("opens with the given password, or none", () => {
    const session = fakeSession();
    const data = new ArrayBuffer(3);
    expect(
      handleRequest(session, { op: "open", data, password: "pw" }).result,
    ).toEqual({
      status: "opened",
      pageCount: 4,
    });
    expect(session.open).toHaveBeenCalledWith(new Uint8Array(data), "pw");
    handleRequest(session, { op: "open", data, password: 42 as never });
    expect(session.open).toHaveBeenLastCalledWith(expect.any(Uint8Array), "");
  });

  it("tells a missing password from a wrong one", () => {
    const session = fakeSession({
      open: () => {
        throw new PdfOpenError("password");
      },
    });
    const data = new ArrayBuffer(1);
    expect(handleRequest(session, { op: "open", data }).result).toEqual({
      status: "password-required",
    });
    expect(
      handleRequest(session, { op: "open", data, password: "x" }).result,
    ).toEqual({
      status: "wrong-password",
    });
  });

  it("reports other open failures", () => {
    const failing = (err: unknown) =>
      fakeSession({
        open: () => {
          throw err;
        },
      });
    expect(
      handleRequest(failing(new PdfOpenError("format")), {
        op: "open",
        data: new ArrayBuffer(1),
      }).result,
    ).toMatchObject({
      status: "error",
      reason: "failed",
      message: expect.stringMatching(/valid PDF/),
    });
    expect(
      handleRequest(failing(new RangeError("out of memory")), {
        op: "open",
        data: new ArrayBuffer(1),
      }).result,
    ).toMatchObject({ reason: "out-of-memory" });
  });

  it("renders a preview and transfers its pixels", () => {
    const session = fakeSession();
    const out = handleRequest(session, {
      op: "preview",
      pageIndex: 1,
      width: 300,
      settings: DEFAULT_SETTINGS,
    });
    expect(session.preview).toHaveBeenCalledWith(1, 300, DEFAULT_SETTINGS);
    expect(out.result).toMatchObject({
      status: "rendered",
      width: 2,
      height: 1,
    });
    if (out.result.status !== "rendered") throw new Error("unreachable");
    expect(out.transfer).toEqual([out.result.pixels]);
  });

  it("applies and transfers the PDF", () => {
    const session = fakeSession();
    const out = handleRequest(session, {
      op: "apply",
      settings: DEFAULT_SETTINGS,
      pages: [0],
    });
    expect(session.apply).toHaveBeenCalledWith(DEFAULT_SETTINGS, [0]);
    if (out.result.status !== "watermarked") throw new Error("unreachable");
    expect(Array.from(new Uint8Array(out.result.data))).toEqual([37, 80]);
    expect(out.transfer).toEqual([out.result.data]);
  });

  it("closes, and refuses unknown requests", () => {
    const session = fakeSession();
    expect(handleRequest(session, { op: "close" }).result).toEqual({
      status: "closed",
    });
    expect(session.close).toHaveBeenCalled();
    expect(
      handleRequest(session, { op: "nope" } as never).result,
    ).toMatchObject({
      status: "error",
      message: "Unknown request.",
    });
  });
});

describe("createWatermarkHandler", () => {
  it("runs requests against the session", async () => {
    const out = await createWatermarkHandler(async () => fakeSession())(
      { op: "close" },
      ctx,
    );
    expect(out.result).toEqual({ status: "closed" });
  });

  it("reports an engine that failed to load, except for close", async () => {
    const handle = createWatermarkHandler(async () => {
      throw new Error("Failed to fetch");
    });
    expect(
      (
        await handle(
          { op: "apply", settings: DEFAULT_SETTINGS, pages: [0] },
          ctx,
        )
      ).result,
    ).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: Failed to fetch",
    });
    expect((await handle({ op: "close" }, ctx)).result).toEqual({
      status: "closed",
    });
  });

  it("turns exceptions into results instead of rejecting", async () => {
    const handle = createWatermarkHandler(async () =>
      fakeSession({
        apply: () => {
          throw new InvalidSettingsError("Choose at least one page.");
        },
      }),
    );
    expect(
      (
        await handle(
          { op: "apply", settings: DEFAULT_SETTINGS, pages: [] },
          ctx,
        )
      ).result,
    ).toEqual({
      status: "error",
      reason: "failed",
      message: "Choose at least one page.",
    });
  });
});
