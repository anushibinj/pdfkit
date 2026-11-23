import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildOcrReport } from "./core/report";
import type { OcrWorkerResult } from "./messages";
import type { OcrClient } from "./ocr-client";
import { useOcrPdf } from "./use-ocr-pdf";

function createFakeClient(
  impl?: Partial<OcrClient>,
): OcrClient & { terminate: ReturnType<typeof vi.fn<() => void>> } {
  const terminate = vi.fn<() => void>();
  return {
    runOcr: vi.fn(async (_data, _name, _opts, _pw, onProgress) => {
      onProgress?.(0.5, "Recognizing page 1…");
      return {
        status: "completed" as const,
        data: new Uint8Array([37, 80, 68, 70]).buffer,
        report: buildOcrReport([
          {
            pageIndex: 0,
            status: "ocr",
            text: "Hello OCR",
            confidence: 94,
            wordCount: 2,
          },
        ]),
        wasImageInput: false,
      };
    }),
    ...impl,
    terminate,
  };
}

describe("useOcrPdf", () => {
  it("runs OCR on queued files and populates completed state", async () => {
    const client = createFakeClient();
    const { result } = renderHook(() => useOcrPdf(() => client));

    const file = new File([new Uint8Array([1, 2])], "scan.pdf", {
      type: "application/pdf",
    });

    act(() => {
      result.current.addFiles([file]);
    });
    expect(result.current.state.items).toHaveLength(1);

    await act(async () => {
      await result.current.runAll();
    });

    expect(result.current.state.isProcessing).toBe(false);
    expect(result.current.state.items[0].status.kind).toBe("completed");
    expect(result.current.state.inspectedTextItemId).toBe(
      result.current.state.items[0].id,
    );
  });

  it("handles cancellation by terminating and restarting worker", async () => {
    let resolvePending: (() => void) | undefined;
    const clients: ReturnType<typeof createFakeClient>[] = [];
    const factory = () => {
      const c = createFakeClient({
        runOcr: vi.fn(
          () =>
            new Promise<OcrWorkerResult>((resolve) => {
              resolvePending = () => resolve({ status: "cancelled" });
            }),
        ),
      });
      clients.push(c);
      return c;
    };

    const { result } = renderHook(() => useOcrPdf(factory));
    const file = new File([new Uint8Array([1])], "scan.pdf", {
      type: "application/pdf",
    });

    act(() => {
      result.current.addFiles([file]);
    });

    let runPromise: Promise<void>;
    act(() => {
      runPromise = result.current.runAll();
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.cancel();
    });

    expect(clients[0].terminate).toHaveBeenCalledTimes(1);
    expect(clients).toHaveLength(2);
    expect(result.current.state.isProcessing).toBe(false);
    expect(result.current.state.items[0].status).toEqual({ kind: "ready" });

    resolvePending?.();
    await act(async () => {
      await runPromise!;
    });
  });
});
