import { describe, expect, it, vi } from "vitest";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import type { PreviewRequest } from "../messages";
import {
  createPreviewHandler,
  handlePreviewRequest,
  type PreviewSessionLike,
} from "./preview-handler";

function fakeSession() {
  return {
    open: vi.fn<PreviewSessionLike["open"]>(() => [{ width: 600, height: 400 }]),
    render: vi.fn<PreviewSessionLike["render"]>(() => ({
      width: 2,
      height: 1,
      pixels: new Uint8Array(8),
    })),
    close: vi.fn<PreviewSessionLike["close"]>(),
  };
}

const ctx = { progress: vi.fn() };

describe("handlePreviewRequest", () => {
  it("opens with the password and returns the page sizes", () => {
    const session = fakeSession();
    const data = new Uint8Array([1, 2]).buffer;
    expect(
      handlePreviewRequest(session, { op: "open", data, password: "pw" }).result,
    ).toEqual({ status: "opened", pages: [{ width: 600, height: 400 }] });
    expect(session.open).toHaveBeenCalledWith(new Uint8Array([1, 2]), "pw");
  });

  it("treats a missing or odd password as none", () => {
    const session = fakeSession();
    const data = new ArrayBuffer(1);
    handlePreviewRequest(session, {
      op: "open",
      data,
      password: 42 as unknown as string,
    });
    expect(session.open).toHaveBeenCalledWith(expect.any(Uint8Array), "");
  });

  it("refuses an open request without file bytes", () => {
    expect(
      handlePreviewRequest(fakeSession(), {
        op: "open",
        data: "x" as unknown as ArrayBuffer,
      }).result,
    ).toMatchObject({ status: "error", message: "No file was received." });
  });

  it("splits password errors into 'required' and 'wrong'", () => {
    const session = fakeSession();
    session.open.mockImplementation(() => {
      throw new PdfOpenError("password");
    });
    const data = new ArrayBuffer(1);
    expect(handlePreviewRequest(session, { op: "open", data }).result).toEqual({
      status: "password-required",
    });
    expect(
      handlePreviewRequest(session, { op: "open", data, password: "x" }).result,
    ).toEqual({ status: "wrong-password" });
  });

  it("reports other open failures with PDFium's message, or classified", () => {
    const session = fakeSession();
    session.open.mockImplementationOnce(() => {
      throw new PdfOpenError("format");
    });
    const data = new ArrayBuffer(1);
    expect(handlePreviewRequest(session, { op: "open", data }).result).toMatchObject({
      status: "error",
      reason: "failed",
      message: expect.stringMatching(/valid PDF/),
    });
    session.open.mockImplementationOnce(() => {
      throw new RangeError("Array buffer allocation failed");
    });
    expect(handlePreviewRequest(session, { op: "open", data }).result).toMatchObject({
      reason: "out-of-memory",
    });
  });

  it("renders and transfers the pixels", () => {
    const session = fakeSession();
    const { result, transfer } = handlePreviewRequest(session, {
      op: "render",
      pageIndex: 3,
      width: 200,
    });
    expect(session.render).toHaveBeenCalledWith(3, 200);
    expect(result).toMatchObject({ status: "rendered", width: 2, height: 1 });
    if (result.status !== "rendered") throw new Error("unreachable");
    expect(transfer).toEqual([result.pixels]);
    expect(result.pixels.byteLength).toBe(8);
  });

  it("closes, and answers unknown requests with an error", () => {
    const session = fakeSession();
    expect(handlePreviewRequest(session, { op: "close" }).result).toEqual({
      status: "closed",
    });
    expect(session.close).toHaveBeenCalled();
    expect(
      handlePreviewRequest(session, { op: "nope" } as unknown as PreviewRequest)
        .result,
    ).toMatchObject({ status: "error", message: "Unknown request." });
  });
});

describe("createPreviewHandler", () => {
  it("reports an engine that cannot load, except for close", async () => {
    const handler = createPreviewHandler(async () => {
      throw new Error("Failed to fetch");
    });
    expect(
      (await handler({ op: "render", pageIndex: 0, width: 1 }, ctx)).result,
    ).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: Failed to fetch",
    });
    expect((await handler({ op: "close" }, ctx)).result).toEqual({
      status: "closed",
    });
  });

  it("turns render exceptions into results instead of rejecting", async () => {
    const session = fakeSession();
    session.render.mockImplementation(() => {
      throw new WebAssembly.RuntimeError("unreachable");
    });
    const handler = createPreviewHandler(async () => session);
    expect(
      (await handler({ op: "render", pageIndex: 0, width: 1 }, ctx)).result,
    ).toMatchObject({ status: "error", reason: "crashed" });
  });
});
