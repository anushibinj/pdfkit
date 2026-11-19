import { describe, expect, it, vi } from "vitest";
import { InvalidPlanError } from "../core/sanitize-plan";
import { PdfOpenError } from "../engine/pdfium-document";
import type { EditorRequest } from "../messages";
import {
  createEditHandler,
  handleRequest,
  toErrorResult,
  type Session,
} from "./edit-handler";

const info = {
  box: { left: 0, bottom: 0, right: 10, top: 10 },
  rotation: 0 as const,
};

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    open: vi.fn(() => [info]),
    render: vi.fn(() => ({
      width: 1,
      height: 1,
      pixels: new Uint8Array([1, 2, 3, 4]),
    })),
    save: vi.fn(() => new Uint8Array([37, 80])),
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

  it("explains rejected save plans", () => {
    expect(toErrorResult(new InvalidPlanError("bad pages"))).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not save the edits: bad pages",
    });
  });

  it("passes other errors through as failures", () => {
    expect(toErrorResult("PDFium could not draw")).toEqual({
      status: "error",
      reason: "failed",
      message: "PDFium could not draw",
    });
  });
});

describe("handleRequest", () => {
  it("open returns the page list and defaults the password", () => {
    const session = fakeSession();
    const data = new Uint8Array([1]).buffer;
    expect(handleRequest(session, { op: "open", data })).toEqual({
      result: { status: "opened", pages: [info] },
    });
    expect(session.open).toHaveBeenCalledWith(new Uint8Array([1]), "");
  });

  it("open tells a missing password from a wrong one", () => {
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

  it("open reports other refusals with PDFium's reason", () => {
    const session = fakeSession({
      open: () => {
        throw new PdfOpenError("format");
      },
    });
    expect(
      handleRequest(session, { op: "open", data: new ArrayBuffer(1) }).result,
    ).toMatchObject({
      status: "error",
      reason: "failed",
      message: expect.stringMatching(/valid PDF/),
    });
  });

  it("open classifies unexpected errors", () => {
    const session = fakeSession({
      open: () => {
        throw new RangeError("Array buffer allocation failed");
      },
    });
    expect(
      handleRequest(session, { op: "open", data: new ArrayBuffer(1) }).result,
    ).toMatchObject({
      reason: "out-of-memory",
    });
  });

  it("render transfers the pixels and sanitises the rotation", () => {
    const session = fakeSession();
    const out = handleRequest(session, {
      op: "render",
      pageIndex: 0,
      rotation: 9 as never,
      width: 50,
    });
    expect(session.render).toHaveBeenCalledWith(0, 0, 50);
    expect(out.result).toMatchObject({
      status: "rendered",
      width: 1,
      height: 1,
    });
    if (out.result.status !== "rendered") throw new Error("unreachable");
    expect(out.transfer).toEqual([out.result.pixels]);
  });

  it("save transfers the new file", () => {
    const session = fakeSession();
    const plan = { pages: [], images: [] };
    const out = handleRequest(session, { op: "save", plan });
    expect(session.save).toHaveBeenCalledWith(plan);
    if (out.result.status !== "saved") throw new Error("unreachable");
    expect(Array.from(new Uint8Array(out.result.data))).toEqual([37, 80]);
    expect(out.transfer).toEqual([out.result.data]);
  });

  it("close closes the session", () => {
    const session = fakeSession();
    expect(handleRequest(session, { op: "close" }).result).toEqual({
      status: "closed",
    });
    expect(session.close).toHaveBeenCalled();
  });

  it("refuses unknown operations", () => {
    expect(
      handleRequest(fakeSession(), {
        op: "explode",
      } as unknown as EditorRequest).result,
    ).toMatchObject({
      status: "error",
      message: "Unknown request.",
    });
  });
});

describe("createEditHandler", () => {
  it("runs requests against the loaded session", async () => {
    const handler = createEditHandler(async () => fakeSession());
    expect((await handler({ op: "close" }, ctx)).result).toEqual({
      status: "closed",
    });
  });

  it("reports a failure to load the engine", async () => {
    const handler = createEditHandler(async () => {
      throw new Error("Failed to fetch");
    });
    expect(
      (await handler({ op: "open", data: new ArrayBuffer(1) }, ctx)).result,
    ).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: Failed to fetch",
    });
    // closing needs no engine
    expect((await handler({ op: "close" }, ctx)).result).toEqual({
      status: "closed",
    });
  });

  it("turns exceptions into results instead of rejecting", async () => {
    const handler = createEditHandler(async () =>
      fakeSession({
        render: () => {
          throw new WebAssembly.RuntimeError("unreachable");
        },
      }),
    );
    const out = await handler(
      { op: "render", pageIndex: 0, rotation: 0, width: 1 },
      ctx,
    );
    expect(out.result).toMatchObject({ status: "error", reason: "crashed" });
  });
});
