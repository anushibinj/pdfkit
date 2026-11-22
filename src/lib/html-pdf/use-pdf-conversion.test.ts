import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConvertResult } from "./types";
import { usePdfConversion, type ConversionClient } from "./use-pdf-conversion";

/** Any tool's request works: the hook only forwards it to the client. */
interface FakeRequest {
  source: string;
}

const request: FakeRequest = { source: "# x" };

/** A fake client whose requests the test settles by hand. */
function fakeClients() {
  const clients: {
    client: ConversionClient<FakeRequest>;
    resolve: (r: ConvertResult) => void;
    reject: (e: Error) => void;
    terminated: boolean;
  }[] = [];
  const factory = vi.fn(() => {
    const entry = {
      resolve: (() => {}) as (r: ConvertResult) => void,
      reject: (() => {}) as (e: Error) => void,
      terminated: false,
      client: undefined as unknown as ConversionClient<FakeRequest>,
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

describe("usePdfConversion", () => {
  it("converts and exposes the PDF as a Blob", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfConversion(factory));
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
    const { result } = renderHook(() => usePdfConversion(factory));
    act(() => result.current.convert(request));
    act(() => result.current.convert(request));
    expect(clients[0].client.request).toHaveBeenCalledTimes(1);
  });

  it("shows ordinary failures and keeps the worker", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfConversion(factory));
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
      const { result } = renderHook(() => usePdfConversion(factory));
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
    const { result } = renderHook(() => usePdfConversion(factory));
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
    const { result } = renderHook(() => usePdfConversion(factory));
    act(() => result.current.convert(request));
    await act(async () => result.current.cancel());
    expect(clients[0].terminated).toBe(true);
    expect(result.current.state).toEqual({ kind: "idle" });
    // a new conversion can start right away, on a fresh worker
    act(() => result.current.convert(request));
    expect(result.current.state.kind).toBe("converting");
    expect(clients[1].client.request).toHaveBeenCalledTimes(1);
  });

  it("never offers a cancelled job's late PDF as the next job's result", async () => {
    // A worker can finish in the instant the user presses Cancel, so its
    // answer resolves instead of being rejected by terminate. If the user has
    // already started a new conversion, that late PDF (of the old input) must
    // not be shown as the new one's result.
    const resolvers: ((r: ConvertResult) => void)[] = [];
    const factory = vi.fn((): ConversionClient<FakeRequest> => ({
      request: () =>
        new Promise<ConvertResult>((resolve) => resolvers.push(resolve)),
      terminate: () => {},
    }));
    const { result } = renderHook(() => usePdfConversion(factory));
    act(() => result.current.convert(request));
    act(() => result.current.cancel());
    act(() => result.current.convert(request));
    expect(resolvers).toHaveLength(2);

    await act(async () => {
      resolvers[0]({ status: "converted", data: new ArrayBuffer(1) });
    });
    expect(result.current.state.kind).toBe("converting");

    await act(async () => {
      resolvers[1]({ status: "converted", data: new ArrayBuffer(2) });
    });
    const state = result.current.state;
    if (state.kind !== "done")
      throw new Error(`expected done, got ${state.kind}`);
    expect(state.pdf.size).toBe(2);
  });

  it("cancel does nothing when idle", () => {
    const { factory } = fakeClients();
    const { result } = renderHook(() => usePdfConversion(factory));
    act(() => result.current.cancel());
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("inputChanged drops a finished PDF", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfConversion(factory));
    act(() => result.current.convert(request));
    await act(async () => {
      clients[0].resolve({ status: "converted", data: new ArrayBuffer(1) });
    });
    act(() => result.current.inputChanged());
    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("terminates the worker on unmount", () => {
    const { factory, clients } = fakeClients();
    const { unmount } = renderHook(() => usePdfConversion(factory));
    unmount();
    expect(clients[0].terminated).toBe(true);
  });
});
