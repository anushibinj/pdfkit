import { describe, expect, it, vi } from "vitest";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import { InvalidCropPlanError } from "../core/crop-plan";
import { EMPTY_REPORT } from "../core/report";
import { CropModuleError, EncryptedPdfError } from "../engine/crop-session";
import { CropVerificationError } from "../engine/crop-verifier";
import {
  createCropHandler,
  handleRequest,
  toErrorResult,
  type Session,
} from "./crop-handler";

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    open: vi.fn(() => [
      { box: { left: 0, bottom: 0, right: 10, top: 10 }, rotation: 0 as const },
    ]),
    render: vi.fn(() => ({ width: 2, height: 1, pixels: new Uint8Array(8) })),
    crop: vi.fn(async (_plan, onProgress) => {
      onProgress?.("cropping", 1);
      return { pdf: Uint8Array.of(1, 2), report: EMPTY_REPORT, verified: true };
    }),
    close: vi.fn(),
    ...overrides,
  };
}

const ctx = { progress: vi.fn() };

describe("toErrorResult", () => {
  it("classifies memory exhaustion and traps", () => {
    expect(toErrorResult(new RangeError("out of memory")).reason).toBe(
      "out-of-memory",
    );
    const trap = toErrorResult(new WebAssembly.RuntimeError("unreachable"));
    expect(trap.reason).toBe("crashed");
    expect(trap.message).toContain("unreachable");
  });

  it("explains invalid plans and passes other messages through", () => {
    expect(toErrorResult(new InvalidCropPlanError("bad")).message).toBe(
      "The crop settings are invalid: bad.",
    );
    expect(toErrorResult("plain")).toEqual({
      status: "error",
      reason: "failed",
      message: "plain",
    });
  });
});

describe("handleRequest", () => {
  it("opens, and phrases encrypted and unreadable files", async () => {
    const opened = await handleRequest(
      fakeSession(),
      { op: "open", data: new ArrayBuffer(1) },
      ctx,
    );
    expect(opened.result.status).toBe("opened");
    const encrypted = await handleRequest(
      fakeSession({
        open: () => {
          throw new EncryptedPdfError();
        },
      }),
      { op: "open", data: new ArrayBuffer(1) },
      ctx,
    );
    expect(encrypted.result).toMatchObject({ status: "encrypted" });
    const broken = await handleRequest(
      fakeSession({
        open: () => {
          throw new PdfOpenError("format");
        },
      }),
      { op: "open", data: new ArrayBuffer(1) },
      ctx,
    );
    expect(broken.result).toMatchObject({ status: "error", reason: "failed" });
    await expect(
      handleRequest(
        fakeSession({
          open: () => {
            throw new RangeError("out of memory");
          },
        }),
        { op: "open", data: new ArrayBuffer(1) },
        ctx,
      ),
    ).rejects.toThrow(RangeError);
  });

  it("renders and transfers the pixels", async () => {
    const out = await handleRequest(
      fakeSession(),
      { op: "render", pageIndex: 0, width: 2 },
      ctx,
    );
    expect(out.result).toMatchObject({
      status: "rendered",
      width: 2,
      height: 1,
    });
    expect(out.transfer).toHaveLength(1);
    await expect(
      handleRequest(
        fakeSession(),
        { op: "render", pageIndex: 0.5, width: 2 },
        ctx,
      ),
    ).rejects.toThrow("Invalid render request");
  });

  it("crops, reports progress and transfers the file", async () => {
    const progress = vi.fn();
    const out = await handleRequest(
      fakeSession(),
      { op: "crop", plan: { removeOutside: true, pages: [] } },
      { progress },
    );
    expect(out.result).toMatchObject({ status: "cropped", verified: true });
    expect(out.transfer).toHaveLength(1);
    expect(progress).toHaveBeenCalledWith(1, "cropping");
  });

  it("phrases a failed check and a module error", async () => {
    const failed = await handleRequest(
      fakeSession({
        crop: async () => {
          throw new CropVerificationError(2, { kind: "text", message: "x" });
        },
      }),
      { op: "crop", plan: { removeOutside: true, pages: [] } },
      ctx,
    );
    expect(failed.result).toEqual({
      status: "check-failed",
      pageIndex: 2,
      message: "Page 3: x.",
    });
    const refused = await handleRequest(
      fakeSession({
        crop: async () => {
          throw new CropModuleError("empty-crop", "Nothing left.");
        },
      }),
      { op: "crop", plan: { removeOutside: false, pages: [] } },
      ctx,
    );
    expect(refused.result).toEqual({
      status: "error",
      reason: "failed",
      message: "Nothing left.",
    });
  });

  it("closes, and refuses unknown requests", async () => {
    const session = fakeSession();
    expect((await handleRequest(session, { op: "close" }, ctx)).result).toEqual(
      {
        status: "closed",
      },
    );
    expect(session.close).toHaveBeenCalled();
    const unknown = await handleRequest(session, { op: "nope" } as never, ctx);
    expect(unknown.result).toMatchObject({ status: "error" });
  });
});

describe("createCropHandler", () => {
  it("reports an engine that cannot load, except for close", async () => {
    const handler = createCropHandler(async () => {
      throw new Error("offline");
    });
    expect(
      (await handler({ op: "render", pageIndex: 0, width: 1 }, ctx)).result,
    ).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: offline",
    });
    expect((await handler({ op: "close" }, ctx)).result).toEqual({
      status: "closed",
    });
  });

  it("turns any exception into a typed result", async () => {
    const handler = createCropHandler(async () =>
      fakeSession({
        render: () => {
          throw new WebAssembly.RuntimeError("trap");
        },
      }),
    );
    const out = await handler({ op: "render", pageIndex: 0, width: 1 }, ctx);
    expect(out.result).toMatchObject({ status: "error", reason: "crashed" });
  });
});
