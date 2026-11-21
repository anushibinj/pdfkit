import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MergeClient } from "./merge-client";
import type { MergeItem } from "./merge-state";
import type { InspectResult, MergeResult, MergeSource } from "./messages";
import {
  UNREADABLE_FILE_MESSAGE,
  describeMergeError,
  useMergePdfs,
} from "./use-merge-pdfs";

const pdfFile = (name: string, bytes: number[] = [1]) =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

/** A fake client whose requests the test answers by hand, in order. */
function fakeClient() {
  const inspections: {
    source: MergeSource;
    answer: (r: InspectResult) => void;
  }[] = [];
  const merges: { sources: MergeSource[]; answer: (r: MergeResult) => void }[] =
    [];
  const client: MergeClient = {
    inspect: vi.fn(
      (source: MergeSource) =>
        new Promise<InspectResult>((resolve) =>
          inspections.push({ source, answer: resolve }),
        ),
    ),
    merge: vi.fn(
      (sources: MergeSource[]) =>
        new Promise<MergeResult>((resolve) =>
          merges.push({ sources, answer: resolve }),
        ),
    ),
    terminate: vi.fn(),
  };
  return { client, inspections, merges };
}

/** Let pending promise callbacks (file reads, dispatches) run. */
const settle = () => act(async () => {});

const bytesOf = (source: MergeSource) =>
  Array.from(new Uint8Array(source.data));

describe("useMergePdfs", () => {
  it("checks added files one at a time and records their page counts", async () => {
    const { client, inspections } = fakeClient();
    const { result } = renderHook(() => useMergePdfs(() => client));
    act(() =>
      result.current.add([pdfFile("a.pdf", [1]), pdfFile("b.pdf", [2])]),
    );
    await settle();

    expect(inspections).toHaveLength(1);
    expect(bytesOf(inspections[0].source)).toEqual([1]);
    expect(result.current.state.items.map((i) => i.status.kind)).toEqual([
      "checking",
      "queued",
    ]);

    await act(async () =>
      inspections[0].answer({ status: "inspected", pageCount: 2 }),
    );
    await settle();
    expect(inspections).toHaveLength(2);
    expect(bytesOf(inspections[1].source)).toEqual([2]);

    await act(async () =>
      inspections[1].answer({ status: "inspected", pageCount: 3 }),
    );
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      { kind: "ready", pageCount: 2, password: undefined },
      { kind: "ready", pageCount: 3, password: undefined },
    ]);
  });

  it("asks for a password and re-checks the file with it", async () => {
    const { client, inspections } = fakeClient();
    const { result } = renderHook(() => useMergePdfs(() => client));
    act(() => result.current.add([pdfFile("locked.pdf")]));
    await settle();
    await act(async () =>
      inspections[0].answer({ status: "password-required" }),
    );
    const [item] = result.current.state.items;
    expect(item.status).toEqual({
      kind: "needs-password",
      wrong: false,
      dismissed: false,
    });

    act(() => result.current.submitPassword(item.id, "hunter2"));
    await settle();
    expect(inspections[1].source.password).toBe("hunter2");
    await act(async () =>
      inspections[1].answer({ status: "inspected", pageCount: 1 }),
    );
    expect(result.current.state.items[0].status).toEqual({
      kind: "ready",
      pageCount: 1,
      password: "hunter2",
    });
  });

  it("marks a file that can no longer be read", async () => {
    const { client } = fakeClient();
    const broken = pdfFile("gone.pdf");
    broken.arrayBuffer = () => Promise.reject(new DOMException("NotReadable"));
    const { result } = renderHook(() => useMergePdfs(() => client));
    act(() => result.current.add([broken]));
    await settle();
    expect(client.inspect).not.toHaveBeenCalled();
    expect(result.current.state.items[0].status).toEqual({
      kind: "error",
      reason: "failed",
      message: UNREADABLE_FILE_MESSAGE,
    });
  });

  /** Two files checked and ready, the second one with a password. */
  async function twoReadyFiles() {
    const fake = fakeClient();
    const hook = renderHook(() => useMergePdfs(() => fake.client));
    act(() =>
      hook.result.current.add([pdfFile("a.pdf", [1]), pdfFile("b.pdf", [2])]),
    );
    await settle();
    await act(async () =>
      fake.inspections[0].answer({ status: "inspected", pageCount: 1 }),
    );
    await settle();
    await act(async () =>
      fake.inspections[1].answer({ status: "password-required" }),
    );
    const id = hook.result.current.state.items[1].id;
    act(() => hook.result.current.submitPassword(id, "pw"));
    await settle();
    await act(async () =>
      fake.inspections[2].answer({ status: "inspected", pageCount: 2 }),
    );
    return { ...fake, ...hook };
  }

  it("merges the files in list order with their passwords", async () => {
    const { result, merges } = await twoReadyFiles();
    const [a, b] = result.current.state.items;
    act(() => result.current.move(b.id, -1)); // b first now
    act(() => result.current.merge());
    expect(result.current.state.outcome.kind).toBe("merging");
    await settle();

    expect(merges).toHaveLength(1);
    expect(merges[0].sources.map(bytesOf)).toEqual([[2], [1]]);
    expect(merges[0].sources.map((s) => s.password)).toEqual(["pw", undefined]);
    expect(a.status.kind).toBe("ready");

    await act(async () =>
      merges[0].answer({
        status: "merged",
        data: new Uint8Array([37, 80]).buffer,
      }),
    );
    const outcome = result.current.state.outcome;
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") throw new Error("unreachable");
    expect(outcome.pdf.type).toBe("application/pdf");
    expect(outcome.pdf.size).toBe(2);
    expect(outcome.pageCount).toBe(3);
  });

  it("names the file a merge failed on", async () => {
    const { result, merges } = await twoReadyFiles();
    act(() => result.current.merge());
    await settle();
    await act(async () =>
      merges[0].answer({
        status: "error",
        reason: "failed",
        message: "Damaged",
        sourceIndex: 1,
      }),
    );
    expect(result.current.state.outcome).toEqual({
      kind: "error",
      reason: "failed",
      message: "b.pdf: Damaged",
    });
  });

  it("reports a worker that fails while merging", async () => {
    const { result, client } = await twoReadyFiles();
    vi.mocked(client.merge).mockRejectedValueOnce(
      new Error("The worker crashed"),
    );
    act(() => result.current.merge());
    await settle();
    expect(result.current.state.outcome).toEqual({
      kind: "error",
      reason: "failed",
      message: "The worker crashed",
    });
  });

  it("does not merge while something blocks it", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useMergePdfs(() => client));
    act(() => result.current.add([pdfFile("only.pdf")]));
    act(() => result.current.merge());
    await settle();
    expect(client.merge).not.toHaveBeenCalled();
    expect(result.current.state.outcome.kind).toBe("idle");
  });

  it("forwards list edits to the state", async () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useMergePdfs(() => client));
    act(() => result.current.add([pdfFile("a.pdf"), pdfFile("b.pdf")]));
    const [a, b] = result.current.state.items;
    act(() => result.current.move(a.id, 1));
    expect(result.current.state.items.map((i) => i.id)).toEqual([b.id, a.id]);
    act(() => result.current.remove(a.id));
    expect(result.current.state.items.map((i) => i.id)).toEqual([b.id]);
    act(() => result.current.clear());
    expect(result.current.state.items).toEqual([]);
  });

  it("terminates the worker on unmount and ignores late answers", async () => {
    const { client, inspections } = fakeClient();
    const { result, unmount } = renderHook(() => useMergePdfs(() => client));
    act(() => result.current.add([pdfFile("a.pdf")]));
    await settle();
    const before = result.current.state;
    unmount();
    expect(client.terminate).toHaveBeenCalled();
    await act(async () =>
      inspections[0].answer({ status: "inspected", pageCount: 1 }),
    );
    expect(result.current.state).toBe(before);
  });
});

describe("describeMergeError", () => {
  const items = [
    { id: "1", file: pdfFile("first.pdf") },
    { id: "2", file: pdfFile("second.pdf") },
  ] as MergeItem[];

  it("prefixes the failing file's name", () => {
    expect(
      describeMergeError(
        { status: "error", reason: "failed", message: "Bad", sourceIndex: 0 },
        items,
      ),
    ).toBe("first.pdf: Bad");
  });

  it("keeps the message alone when the file is unknown", () => {
    expect(
      describeMergeError(
        { status: "error", reason: "failed", message: "Bad" },
        items,
      ),
    ).toBe("Bad");
    expect(
      describeMergeError(
        { status: "error", reason: "failed", message: "Bad", sourceIndex: 9 },
        items,
      ),
    ).toBe("Bad");
  });
});
