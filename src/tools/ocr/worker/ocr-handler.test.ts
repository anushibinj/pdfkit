import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OCR_OPTIONS } from "../core/options";
import { buildOcrReport } from "../core/report";
import { createOcrHandler, type OcrWorkerSession } from "./ocr-handler";

function makeContext() {
  return {
    progress: vi.fn(),
  };
}

describe("createOcrHandler", () => {
  it("responds to ping without initializing session", async () => {
    const getSession = vi.fn();
    const handler = createOcrHandler(getSession);
    const res = await handler({ op: "ping" }, makeContext());
    expect(res).toEqual({ result: { status: "pong" } });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("transfers completed OCR PDF bytes and forwards progress", async () => {
    const report = buildOcrReport([
      {
        pageIndex: 0,
        status: "ocr",
        text: "Hello",
        confidence: 95,
        wordCount: 1,
      },
    ]);
    const session: OcrWorkerSession = {
      run: vi.fn(async (_bytes, _opts, _pw, onProgress) => {
        onProgress?.(0.5, "Recognizing page 1…");
        return {
          kind: "completed" as const,
          pdf: new Uint8Array([37, 80, 68, 70]),
          report,
          wasImageInput: false,
        };
      }),
    };

    const handler = createOcrHandler(async () => session);
    const ctx = makeContext();
    const res = await handler(
      {
        op: "ocr",
        data: new ArrayBuffer(4),
        filename: "scan.pdf",
        options: DEFAULT_OCR_OPTIONS,
      },
      ctx,
    );

    expect(ctx.progress).toHaveBeenCalledWith(0.02, "Loading OCR engine…");
    expect(ctx.progress).toHaveBeenCalledWith(0.5, "Recognizing page 1…");
    expect(res.result.status).toBe("completed");
    expect(res.transfer).toHaveLength(1);
  });

  it("maps password-required, failed, and out-of-memory errors", async () => {
    const session: OcrWorkerSession = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          kind: "password-required",
          wrongPassword: true,
        })
        .mockResolvedValueOnce({
          kind: "failed",
          message: "Bad file",
        })
        .mockRejectedValueOnce(new RangeError("Array buffer allocation failed")),
    };

    const handler = createOcrHandler(async () => session);
    const ctx = makeContext();

    const pwRes = await handler(
      {
        op: "ocr",
        data: new ArrayBuffer(1),
        filename: "locked.pdf",
        options: DEFAULT_OCR_OPTIONS,
      },
      ctx,
    );
    expect(pwRes.result).toEqual({
      status: "password-required",
      wrongPassword: true,
    });

    const failRes = await handler(
      {
        op: "ocr",
        data: new ArrayBuffer(1),
        filename: "bad.pdf",
        options: DEFAULT_OCR_OPTIONS,
      },
      ctx,
    );
    expect(failRes.result).toEqual({
      status: "error",
      message: "Bad file",
    });

    const oomRes = await handler(
      {
        op: "ocr",
        data: new ArrayBuffer(1),
        filename: "huge.pdf",
        options: DEFAULT_OCR_OPTIONS,
      },
      ctx,
    );
    expect(oomRes.result.status).toBe("error");
    if (oomRes.result.status === "error") {
      expect(oomRes.result.message).toMatch(/ran out of memory/i);
    }
  });
});
