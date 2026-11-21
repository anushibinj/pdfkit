import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CANCELLED, type AssemblyService } from "./assembly-service";
import type { AssembleResult } from "./messages";
import { finalState, useSplitOutputs, type BuildRequest } from "./use-split-outputs";

const request: BuildRequest = {
  key: "k1",
  source: { data: new ArrayBuffer(2), password: "pw" },
  pageCount: 3,
  outputs: [
    { name: "a-page-1.pdf", pages: [0] },
    { name: "a-pages-2-3.pdf", pages: [1, 2] },
  ],
};

/** A service whose assemble waits until `finish` is called. */
function fakeService() {
  let finish: (r: AssembleResult) => void = () => {};
  let report: (p: number) => void = () => {};
  const service = {
    assemble: vi.fn(
      (
        _data: ArrayBuffer,
        _password: string,
        _count: number,
        _outputs: number[][],
        onProgress?: (p: number) => void,
      ) =>
        new Promise<AssembleResult>((resolve) => {
          finish = resolve;
          report = (p) => onProgress?.(p);
        }),
    ),
    cancel: vi.fn(() => finish(CANCELLED)),
    dispose: vi.fn(),
  };
  return {
    service,
    finish: (r: AssembleResult) => finish(r),
    report: (p: number) => report(p),
  };
}

function setup() {
  const fake = fakeService();
  const hook = renderHook(() =>
    useSplitOutputs(() => fake.service as unknown as AssemblyService),
  );
  return { ...fake, ...hook };
}

describe("useSplitOutputs", () => {
  it("builds the files, reports progress and names the results", async () => {
    const { result, service, finish, report } = setup();
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.build(request);
    });
    expect(result.current.state).toEqual({ kind: "working", key: "k1", progress: 0 });
    expect(service.assemble).toHaveBeenCalledWith(
      request.source.data,
      "pw",
      3,
      [[0], [1, 2]],
      expect.any(Function),
    );
    act(() => report(0.5));
    expect(result.current.state).toMatchObject({ progress: 0.5 });
    const files = [
      { data: new ArrayBuffer(1), crc32: 1 },
      { data: new ArrayBuffer(2), crc32: 2 },
    ];
    let ended: unknown;
    await act(async () => {
      finish({ status: "assembled", files, warnings: "fixed" });
      ended = await run;
    });
    expect(ended).toBe(result.current.state);
    expect(result.current.state).toEqual({
      kind: "done",
      key: "k1",
      warnings: "fixed",
      files: [
        { name: "a-page-1.pdf", pages: [0], data: files[0].data, crc32: 1 },
        { name: "a-pages-2-3.pdf", pages: [1, 2], data: files[1].data, crc32: 2 },
      ],
    });
  });

  it("shows failures with their message", async () => {
    const { result, finish } = setup();
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.build(request);
    });
    await act(async () => {
      finish({ status: "error", reason: "failed", message: "Damaged file" });
      await run;
    });
    expect(result.current.state).toEqual({
      kind: "failed",
      key: "k1",
      message: "Damaged file",
    });
  });

  it("explains a refused password", async () => {
    const { result, finish } = setup();
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.build(request);
    });
    await act(async () => {
      finish({ status: "wrong-password" });
      await run;
    });
    expect(result.current.state).toMatchObject({
      kind: "failed",
      message: expect.stringMatching(/password was not accepted/),
    });
  });

  it("cancel stops the worker and goes back to idle", async () => {
    const { result, service } = setup();
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.build(request);
    });
    await act(async () => {
      result.current.cancel();
      await run;
    });
    expect(service.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("reset after a finished build does not stop the idle worker", async () => {
    const { result, service, finish } = setup();
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.build(request);
    });
    await act(async () => {
      finish({ status: "assembled", files: [] });
      await run;
    });
    act(() => result.current.reset());
    expect(service.cancel).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("ignores a result that arrives after a reset", async () => {
    const { result, finish } = setup();
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.build(request);
    });
    act(() => result.current.reset());
    let ended: unknown = "not set";
    await act(async () => {
      finish({ status: "assembled", files: [] });
      ended = await run;
    });
    expect(ended).toBeNull();
    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("disposes the service on unmount", () => {
    const { service, unmount } = setup();
    unmount();
    expect(service.dispose).toHaveBeenCalled();
  });
});

describe("finalState", () => {
  it("turns a cancelled build into idle, not an error", () => {
    expect(finalState("k", request, CANCELLED)).toEqual({ kind: "idle" });
  });

  it("keeps other errors as failures with their message", () => {
    expect(
      finalState("k", request, { status: "error", reason: "crashed", message: "trap" }),
    ).toEqual({ kind: "failed", key: "k", message: "trap" });
  });
});
