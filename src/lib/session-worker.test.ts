import { describe, expect, it, vi } from "vitest";
import {
  SessionWorker,
  type SessionErrorResult,
  type SessionWorkerClient,
} from "./session-worker";

type Req =
  | { op: "open"; data: ArrayBuffer; password: string }
  | { op: "work"; n: number }
  | { op: "close" };
type Res =
  { status: "opened" } | { status: "locked" } | { status: "done"; n: number };
type Answer = Res | SessionErrorResult | Error;

/**
 * Fake clients, one per worker lifetime. `answers` is consumed in order
 * across all of them; an Error rejects the request (a dead worker).
 */
function setup(answers: Answer[]) {
  const sent: { worker: number; payload: Req; transfer?: Transferable[] }[] =
    [];
  const clients: { terminate: ReturnType<typeof vi.fn> }[] = [];
  const factory = vi.fn(
    (): SessionWorkerClient<Req, Res | SessionErrorResult> => {
      const worker = clients.length;
      const client = {
        request: vi.fn(
          async (payload: Req, options?: { transfer?: Transferable[] }) => {
            sent.push({ worker, payload, transfer: options?.transfer });
            const answer = answers.shift();
            if (!answer) throw new Error("no answer scripted");
            if (answer instanceof Error) throw answer;
            return answer;
          },
        ),
        terminate: vi.fn(),
      };
      clients.push(client);
      return client;
    },
  );
  const session = new SessionWorker<Req, Res>(factory, {
    openRequest: (data, password) => ({ op: "open", data, password }),
    isOpened: (result) => result.status === "opened",
    disposedMessage: "The tool was closed.",
  });
  return { session, sent, clients, factory };
}

const crashed: SessionErrorResult = {
  status: "error",
  reason: "crashed",
  message: "trap",
};
const file = () => new Uint8Array([1, 2, 3]).buffer;

describe("SessionWorker", () => {
  it("creates no worker until the first request", () => {
    const { factory } = setup([]);
    expect(factory).not.toHaveBeenCalled();
  });

  it("open transfers a copy of the file and keeps the original", async () => {
    const { session, sent } = setup([{ status: "opened" }]);
    const data = file();
    expect(await session.open(data, "pw")).toEqual({ status: "opened" });
    const request = sent[0].payload as Extract<Req, { op: "open" }>;
    expect(request.data).not.toBe(data);
    expect(sent[0].transfer).toEqual([request.data]);
    expect(request.password).toBe("pw");
    expect(data.byteLength).toBe(3); // not detached
  });

  it("runs requests one after another", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { session, factory } = setup([]);
    const order: string[] = [];
    factory.mockImplementation(() => ({
      request: async (payload: Req) => {
        order.push(`start ${payload.op === "work" ? payload.n : payload.op}`);
        if (payload.op === "work" && payload.n === 1) await gate;
        order.push(`end ${payload.op === "work" ? payload.n : payload.op}`);
        return { status: "done", n: 0 } as Res;
      },
      terminate: vi.fn(),
    }));
    const first = session.request({ op: "work", n: 1 });
    const second = session.request({ op: "work", n: 2 });
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });

  it("restarts a crashed worker and silently reopens the file before the next request", async () => {
    const { session, sent, clients } = setup([
      { status: "opened" },
      crashed,
      { status: "opened" },
      { status: "done", n: 2 },
    ]);
    await session.open(file(), "pw");
    expect(await session.request({ op: "work", n: 1 })).toBe(crashed);
    expect(clients[0].terminate).toHaveBeenCalled();
    expect(await session.request({ op: "work", n: 2 })).toEqual({
      status: "done",
      n: 2,
    });
    expect(sent.map((s) => [s.worker, s.payload.op])).toEqual([
      [0, "open"],
      [0, "work"],
      [1, "open"],
      [1, "work"],
    ]);
    expect((sent[2].payload as Extract<Req, { op: "open" }>).password).toBe(
      "pw",
    );
  });

  it("treats a rejected request as a dead worker", async () => {
    const { session, clients } = setup([
      new Error("worker died"),
      { status: "done", n: 1 },
    ]);
    const result = await session.request({ op: "work", n: 1 });
    expect(result).toMatchObject({
      status: "error",
      reason: "crashed",
      message: expect.stringContaining("worker died"),
    });
    expect(clients[0].terminate).toHaveBeenCalled();
    await session.request({ op: "work", n: 1 });
    expect(clients).toHaveLength(2);
  });

  it("keeps the worker after an ordinary failure", async () => {
    const failed: SessionErrorResult = {
      status: "error",
      reason: "failed",
      message: "bad",
    };
    const { session, clients } = setup([failed, { status: "done", n: 1 }]);
    expect(await session.request({ op: "work", n: 1 })).toBe(failed);
    await session.request({ op: "work", n: 1 });
    expect(clients).toHaveLength(1);
  });

  it("skips an aborted request with the given cancelled result", async () => {
    const { session, sent } = setup([]);
    const controller = new AbortController();
    controller.abort();
    const cancelled: Res = { status: "locked" };
    expect(
      await session.request(
        { op: "work", n: 1 },
        { signal: controller.signal, cancelled },
      ),
    ).toBe(cancelled);
    expect(sent).toEqual([]);
  });

  it("gives up on a file that cannot be reopened", async () => {
    const { session } = setup([
      { status: "opened" },
      crashed,
      { status: "locked" },
      { status: "done", n: 1 },
    ]);
    await session.open(file(), "");
    await session.request({ op: "work", n: 1 });
    expect(await session.request({ op: "work", n: 2 })).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not reopen the PDF. Open it again.",
    });
    // the file was dropped: the next request is sent without re-opening
    expect(await session.request({ op: "work", n: 3 })).toEqual({
      status: "done",
      n: 1,
    });
  });

  it("does not keep a file that failed to open", async () => {
    const { session, sent } = setup([
      { status: "locked" },
      crashed,
      { status: "done", n: 1 },
    ]);
    await session.open(file(), "");
    await session.request({ op: "work", n: 1 });
    await session.request({ op: "work", n: 2 });
    expect(sent.map((s) => s.payload.op)).toEqual(["open", "work", "work"]);
  });

  it("close tells the worker and forgets the file", async () => {
    const { session, sent } = setup([
      { status: "opened" },
      { status: "done", n: 0 },
      crashed,
      { status: "done", n: 1 },
    ]);
    await session.open(file(), "");
    await session.close({ op: "close" });
    await session.request({ op: "work", n: 1 });
    await session.request({ op: "work", n: 2 });
    expect(sent.map((s) => s.payload.op)).toEqual([
      "open",
      "close",
      "work",
      "work",
    ]);
  });

  it("dispose terminates the worker and answers later requests itself", async () => {
    const { session, clients } = setup([{ status: "done", n: 1 }]);
    await session.request({ op: "work", n: 1 });
    session.dispose();
    expect(clients[0].terminate).toHaveBeenCalled();
    expect(await session.request({ op: "work", n: 2 })).toEqual({
      status: "error",
      reason: "failed",
      message: "The tool was closed.",
    });
  });

  it("does not restart when a request dies because of dispose", async () => {
    const { session, factory } = setup([]);
    let reject: (e: Error) => void = () => {};
    factory.mockImplementation(() => ({
      request: () => new Promise((_, r) => (reject = r)),
      terminate: vi.fn(),
    }));
    const pending = session.request({ op: "work", n: 1 });
    // wait until the request has really been sent to the worker
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    session.dispose();
    reject(new Error("terminated"));
    expect(await pending).toMatchObject({ message: "The tool was closed." });
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
