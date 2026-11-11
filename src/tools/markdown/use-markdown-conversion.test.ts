import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConvertRequest, ConvertResult } from "./messages";
import {
  useMarkdownConversion,
  type ConversionClient,
} from "./use-markdown-conversion";

const request: ConvertRequest = {
  markdown: "# x",
  css: "",
  page: { size: "A4", marginMm: 20 },
};

/** A fake client whose requests the test settles by hand. */
function fakeClients() {
  const clients: {
    client: ConversionClient;
    resolve: (r: ConvertResult) => void;
    reject: (e: Error) => void;
    terminated: boolean;
  }[] = [];
  const factory = vi.fn(() => {
    const entry = {
      resolve: (() => {}) as (r: ConvertResult) => void,
      reject: (() => {}) as (e: Error) => void,
      terminated: false,
      client: undefined as unknown as ConversionClient,
    };
    entry.client = {
      request: vi.fn(
        () =>
          new Promise<ConvertResult>((resolve, reject) => {
            entry.resolve = resolve;
            entry.reject = reject;
          }),
      ),
      terminate: () => {
        entry.terminated = true;
        entry.reject(new Error("Worker has been terminated"));
      },
    };
    clients.push(entry);
    return entry.client;
  });
  return { factory, clients };
}

describe("useMarkdownConversion", () => {
  it("converts and exposes the PDF as a Blob", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => useMarkdownConversion(factory));
    act(() => result.current.convert(request));
    expect(result.current.state.kind).toBe("converting");
    expect(clients[0].client.request).toHaveBeenCalledWith(request);

    await act(async () => {
      clients[0].resolve({
        status: "converted",
        data: new Uint8Array([1, 2]).buffer,
      });
    });
    const state = result.current.state;
    expect(state.kind).toBe("done");
    if (state.kind !== "done") throw new Error("unreachable");
    expect(state.pdf.type).toBe("application/pdf");
    expect(state.pdf.size).toBe(2);
  });

  it("ignores a second convert while one is running", () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => useMarkdownConversion(factory));
    act(() => result.current.convert(request));
    act(() => result.current.convert(request));
    expect(clients[0].client.request).toHaveBeenCalledTimes(1);
  });

  it("shows ordinary failures and keeps the worker", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => useMarkdownConversion(factory));
    act(() => result.current.convert(request));
    await act(async () => {
      clients[0].resolve({ status: "error", reason: "failed", message: "bad" });
    });
    expect(result.current.state).toEqual({
      kind: "error",
      reason: "failed",
      message: "bad",
    });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it.each(["crashed", "out-of-memory"] as const)(
    "replaces the worker after a %s error",
    async (reason) => {
      const { factory, clients } = fakeClients();
      const { result } = renderHook(() => useMarkdownConversion(factory));
      act(() => result.current.convert(request));
      await act(async () => {
        clients[0].resolve({ status: "error", reason, message: "x" });
      });
      expect(clients[0].terminated).toBe(true);
      expect(factory).toHaveBeenCalledTimes(2);
      // the next conversion goes to the new worker
      act(() => result.current.convert(request));
      expect(clients[1].client.request).toHaveBeenCalledTimes(1);
    },
  );

  it("treats a rejected request as a crash", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => useMarkdownConversion(factory));
    act(() => result.current.convert(request));
    await act(async () => {
      clients[0].reject(new Error("The worker crashed"));
    });
    expect(result.current.state).toEqual({
      kind: "error",
      reason: "crashed",
      message: "The worker crashed",
    });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("cancel terminates the worker and ignores the late rejection", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => useMarkdownConversion(factory));
    act(() => result.current.convert(request));
    await act(async () => result.current.cancel());
    expect(clients[0].terminated).toBe(true);
    expect(result.current.state).toEqual({ kind: "idle" });
    // a new conversion can start right away, on a fresh worker
    act(() => result.current.convert(request));
    expect(result.current.state.kind).toBe("converting");
    expect(clients[1].client.request).toHaveBeenCalledTimes(1);
  });

  it("cancel does nothing when idle", () => {
    const { factory } = fakeClients();
    const { result } = renderHook(() => useMarkdownConversion(factory));
    act(() => result.current.cancel());
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("inputChanged drops a finished PDF", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => useMarkdownConversion(factory));
    act(() => result.current.convert(request));
    await act(async () => {
      clients[0].resolve({ status: "converted", data: new ArrayBuffer(1) });
    });
    act(() => result.current.inputChanged());
    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("terminates the worker on unmount", () => {
    const { factory, clients } = fakeClients();
    const { unmount } = renderHook(() => useMarkdownConversion(factory));
    unmount();
    expect(clients[0].terminated).toBe(true);
  });
});
