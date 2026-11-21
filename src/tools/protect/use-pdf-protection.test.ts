import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkerClient } from "@/lib/worker-client";
import type { ProtectResult } from "./messages";
import {
  createWorkerProtectionClient,
  resultToAction,
  usePdfProtection,
  type ProtectionClient,
} from "./use-pdf-protection";

/** A File-like object whose bytes the test controls. */
function fakeFile(
  read: () => Promise<ArrayBuffer> = async () =>
    new Uint8Array([37, 80]).buffer,
) {
  return {
    name: "report.pdf",
    size: 2,
    arrayBuffer: vi.fn(read),
  } as unknown as File;
}

/** Fake clients whose requests the test settles by hand. */
function fakeClients() {
  const clients: {
    client: ProtectionClient;
    resolve: (r: ProtectResult) => void;
    reject: (e: Error) => void;
    terminated: boolean;
  }[] = [];
  const factory = vi.fn(() => {
    const entry = {
      resolve: (() => {}) as (r: ProtectResult) => void,
      reject: (() => {}) as (e: Error) => void,
      terminated: false,
      client: undefined as unknown as ProtectionClient,
    };
    entry.client = {
      request: vi.fn<ProtectionClient["request"]>(
        () =>
          new Promise<ProtectResult>((resolve, reject) => {
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

/** Let the file read (a resolved promise) finish. */
const flush = () => act(async () => {});

describe("resultToAction", () => {
  it("wraps a protected PDF in a Blob", () => {
    const action = resultToAction({
      status: "protected",
      data: new Uint8Array([1, 2, 3]).buffer,
      replacedRestrictions: true,
      invalidatedSignatures: 3,
      warnings: "w",
    });
    expect(action).toMatchObject({
      type: "succeed",
      replacedRestrictions: true,
      invalidatedSignatures: 3,
      warnings: "w",
    });
    if (action.type !== "succeed") throw new Error("unreachable");
    expect(action.pdf.type).toBe("application/pdf");
    expect(action.pdf.size).toBe(3);
  });

  it("maps already-protected and errors", () => {
    expect(resultToAction({ status: "already-protected" })).toEqual({
      type: "refuse",
    });
    expect(
      resultToAction({
        status: "error",
        reason: "out-of-memory",
        message: "m",
      }),
    ).toEqual({ type: "fail", reason: "out-of-memory", message: "m" });
  });
});

describe("createWorkerProtectionClient", () => {
  it("returns a lazily started worker client", () => {
    const client = createWorkerProtectionClient();
    expect(client).toBeInstanceOf(WorkerClient);
    expect(() => client.terminate()).not.toThrow();
  });
});

describe("usePdfProtection", () => {
  it("reads the file, sends it with the password and transfers the bytes", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfProtection(factory));
    act(() => result.current.protect(fakeFile(), "pw"));
    expect(result.current.state.kind).toBe("protecting");
    await flush();
    const [payload, options] = vi.mocked(clients[0].client.request).mock
      .calls[0];
    expect(payload.password).toBe("pw");
    expect(Array.from(new Uint8Array(payload.data))).toEqual([37, 80]);
    expect(options?.transfer).toEqual([payload.data]);

    await act(async () =>
      clients[0].resolve({
        status: "protected",
        data: new Uint8Array([9, 9]).buffer,
        replacedRestrictions: false,
        invalidatedSignatures: 0,
      }),
    );
    const state = result.current.state;
    expect(state.kind).toBe("done");
    if (state.kind !== "done") throw new Error("unreachable");
    expect(state.pdf.size).toBe(2);
  });

  it("ignores a second protect while one is running", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfProtection(factory));
    const file = fakeFile();
    act(() => result.current.protect(file, "pw"));
    act(() => result.current.protect(file, "pw"));
    await flush();
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(clients[0].client.request).toHaveBeenCalledTimes(1);
  });

  it("reports a PDF that is already protected", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfProtection(factory));
    act(() => result.current.protect(fakeFile(), "pw"));
    await flush();
    await act(async () => clients[0].resolve({ status: "already-protected" }));
    expect(result.current.state).toEqual({ kind: "already-protected" });
  });

  it("shows ordinary failures and keeps the worker", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfProtection(factory));
    act(() => result.current.protect(fakeFile(), "pw"));
    await flush();
    await act(async () =>
      clients[0].resolve({ status: "error", reason: "failed", message: "bad" }),
    );
    expect(result.current.state).toEqual({
      kind: "error",
      reason: "failed",
      message: "bad",
    });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("replaces the worker after running out of memory", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfProtection(factory));
    act(() => result.current.protect(fakeFile(), "pw"));
    await flush();
    await act(async () =>
      clients[0].resolve({
        status: "error",
        reason: "out-of-memory",
        message: "oom",
      }),
    );
    expect(clients[0].terminated).toBe(true);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(result.current.state).toMatchObject({
      kind: "error",
      reason: "out-of-memory",
    });
  });

  it("treats a rejected request as a crash and replaces the worker", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfProtection(factory));
    act(() => result.current.protect(fakeFile(), "pw"));
    await flush();
    await act(async () => clients[0].reject(new Error("The worker crashed")));
    expect(result.current.state).toEqual({
      kind: "error",
      reason: "crashed",
      message: "The worker crashed",
    });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("reports a file that cannot be read", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfProtection(factory));
    act(() =>
      result.current.protect(
        fakeFile(async () => {
          throw new DOMException("NotReadableError");
        }),
        "pw",
      ),
    );
    await flush();
    expect(result.current.state).toEqual({
      kind: "error",
      reason: "failed",
      message: "Could not read report.pdf.",
    });
    expect(clients[0].client.request).not.toHaveBeenCalled();
  });

  it("cancel terminates the worker and ignores the late rejection", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfProtection(factory));
    act(() => result.current.protect(fakeFile(), "pw"));
    await flush();
    await act(async () => result.current.cancel());
    expect(clients[0].terminated).toBe(true);
    expect(result.current.state).toEqual({ kind: "idle" });
    // a new job starts right away, on a fresh worker
    act(() => result.current.protect(fakeFile(), "pw"));
    await flush();
    expect(result.current.state.kind).toBe("protecting");
    expect(clients[1].client.request).toHaveBeenCalledTimes(1);
  });

  it("cancel while the file is being read sends nothing", async () => {
    const { factory, clients } = fakeClients();
    let finishRead: (b: ArrayBuffer) => void = () => {};
    const slow = fakeFile(
      () => new Promise((resolve) => (finishRead = resolve)),
    );
    const { result } = renderHook(() => usePdfProtection(factory));
    act(() => result.current.protect(slow, "pw"));
    act(() => result.current.cancel());
    await act(async () => finishRead(new ArrayBuffer(1)));
    expect(clients[0].client.request).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("cancel does nothing when idle", () => {
    const { factory } = fakeClients();
    const { result } = renderHook(() => usePdfProtection(factory));
    act(() => result.current.cancel());
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("passwordChanged drops a finished PDF; fileChanged drops 'already protected'", async () => {
    const { factory, clients } = fakeClients();
    const { result } = renderHook(() => usePdfProtection(factory));
    act(() => result.current.protect(fakeFile(), "pw"));
    await flush();
    await act(async () =>
      clients[0].resolve({
        status: "protected",
        data: new ArrayBuffer(1),
        replacedRestrictions: false,
        invalidatedSignatures: 0,
      }),
    );
    act(() => result.current.passwordChanged());
    expect(result.current.state).toEqual({ kind: "idle" });

    act(() => result.current.protect(fakeFile(), "pw"));
    await flush();
    await act(async () => clients[0].resolve({ status: "already-protected" }));
    act(() => result.current.passwordChanged());
    expect(result.current.state).toEqual({ kind: "already-protected" });
    act(() => result.current.fileChanged());
    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("terminates the worker on unmount and ignores the pending job", async () => {
    const { factory, clients } = fakeClients();
    const { result, unmount } = renderHook(() => usePdfProtection(factory));
    act(() => result.current.protect(fakeFile(), "pw"));
    await flush();
    unmount();
    expect(clients[0].terminated).toBe(true);
    // the rejection caused by terminating must not start another worker
    await act(async () => {});
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
