import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversionClient } from "@/lib/html-pdf/use-pdf-conversion";
import { WorkerClient } from "@/lib/worker-client";
import type { ConvertRequest } from "./messages";
import {
  createWorkerConversionClient,
  useMarkdownConversion,
} from "./use-markdown-conversion";

const request: ConvertRequest = {
  markdown: "# x",
  css: "",
  page: { size: "A4", marginMm: 20 },
};

describe("createWorkerConversionClient", () => {
  it("returns a lazy WorkerClient without starting a worker", () => {
    // jsdom has no Worker: creating one here would throw, so this also proves
    // that the worker only starts on the first request.
    const client = createWorkerConversionClient();
    expect(client).toBeInstanceOf(WorkerClient);
    client.terminate();
  });
});

describe("useMarkdownConversion", () => {
  it("runs conversions through the injected client", async () => {
    const client: ConversionClient<ConvertRequest> = {
      request: vi.fn(async () => ({
        status: "converted" as const,
        data: new Uint8Array([37]).buffer,
      })),
      terminate: vi.fn(),
    };
    const { result } = renderHook(() => useMarkdownConversion(() => client));
    await act(async () => result.current.convert(request));
    expect(client.request).toHaveBeenCalledWith(request);
    expect(result.current.state.kind).toBe("done");
  });
});
