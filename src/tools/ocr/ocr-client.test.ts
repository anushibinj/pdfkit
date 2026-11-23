import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OCR_OPTIONS } from "./core/options";
import { WorkerOcrClient, type OcrRequestSender } from "./ocr-client";

describe("WorkerOcrClient", () => {
  it("transfers input buffer and forwards progress updates", async () => {
    const request = vi.fn(async (_payload, opts) => {
      opts?.onProgress?.(0.5, "Recognizing…");
      return { status: "cancelled" as const };
    });
    const terminate = vi.fn();
    const sender: OcrRequestSender = { request, terminate };
    const client = new WorkerOcrClient(sender);

    const buf = new ArrayBuffer(8);
    const onProgress = vi.fn();
    const res = await client.runOcr(
      buf,
      "scan.pdf",
      DEFAULT_OCR_OPTIONS,
      "pw",
      onProgress,
    );

    expect(res).toEqual({ status: "cancelled" });
    expect(request).toHaveBeenCalledWith(
      {
        op: "ocr",
        data: buf,
        filename: "scan.pdf",
        options: DEFAULT_OCR_OPTIONS,
        password: "pw",
      },
      expect.objectContaining({ transfer: [buf] }),
    );
    expect(onProgress).toHaveBeenCalledWith(0.5, "Recognizing…");

    client.terminate();
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
