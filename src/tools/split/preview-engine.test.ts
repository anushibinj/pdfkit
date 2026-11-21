import { describe, expect, it, vi } from "vitest";
import type { PreviewRequest, PreviewResult } from "./messages";
import { CANCELLED, PreviewEngine, type PreviewWorkerClient } from "./preview-engine";

const opened: PreviewResult = { status: "opened", pages: [{ width: 1, height: 1 }] };
const rendered: PreviewResult = {
  status: "rendered",
  width: 1,
  height: 1,
  pixels: new ArrayBuffer(4),
};

/** A worker client answering with `respond`; records every request. */
function fakeClient(respond: (req: PreviewRequest) => PreviewResult) {
  const requests: PreviewRequest[] = [];
  const client = {
    request: vi.fn<PreviewWorkerClient["request"]>(async (req) => {
      requests.push(req);
      return respond(req);
    }),
    terminate: vi.fn<PreviewWorkerClient["terminate"]>(),
  };
  return { client, requests };
}

const ok = (req: PreviewRequest): PreviewResult =>
  req.op === "open" ? opened : req.op === "render" ? rendered : { status: "closed" };

describe("PreviewEngine", () => {
  it("opens with a transferred copy and the password", async () => {
    const { client, requests } = fakeClient(ok);
    const engine = new PreviewEngine(() => client);
    const data = new Uint8Array([1, 2, 3]).buffer;
    expect(await engine.open(data, "pw")).toEqual(opened);
    const sent = requests[0] as Extract<PreviewRequest, { op: "open" }>;
    expect(sent.op).toBe("open");
    expect(sent.password).toBe("pw");
    expect(sent.data).not.toBe(data);
    expect(data.byteLength).toBe(3);
  });

  it("renders a page", async () => {
    const { client, requests } = fakeClient(ok);
    const engine = new PreviewEngine(() => client);
    await engine.open(new ArrayBuffer(1));
    expect(await engine.render(2, 150)).toEqual(rendered);
    expect(requests[1]).toEqual({ op: "render", pageIndex: 2, width: 150 });
  });

  it("skips a render aborted while it waited", async () => {
    const { client, requests } = fakeClient(ok);
    const engine = new PreviewEngine(() => client);
    const controller = new AbortController();
    controller.abort();
    expect(await engine.render(0, 100, controller.signal)).toBe(CANCELLED);
    expect(requests).toHaveLength(0);
  });

  it("reopens the file in a new worker after a crash (opened = status 'opened')", async () => {
    let crash = true;
    const clients: ReturnType<typeof fakeClient>[] = [];
    const engine = new PreviewEngine(() => {
      const made = fakeClient((req) => {
        if (req.op === "render" && crash) {
          crash = false;
          return { status: "error", reason: "crashed", message: "trap" };
        }
        return ok(req);
      });
      clients.push(made);
      return made.client;
    });
    await engine.open(new Uint8Array([7]).buffer, "pw");
    expect(await engine.render(0, 10)).toMatchObject({ reason: "crashed" });
    expect(await engine.render(0, 10)).toEqual(rendered);
    expect(clients).toHaveLength(2);
    expect(clients[1].requests[0]).toMatchObject({ op: "open", password: "pw" });
  });

  it("close sends close once a worker exists; dispose stops it for good", async () => {
    const { client, requests } = fakeClient(ok);
    const engine = new PreviewEngine(() => client);
    expect(await engine.close()).toEqual({ status: "closed" });
    expect(requests).toHaveLength(0); // no worker started just to close
    await engine.open(new ArrayBuffer(1));
    await engine.close();
    expect(requests.at(-1)).toEqual({ op: "close" });
    engine.dispose();
    expect(client.terminate).toHaveBeenCalled();
    expect(await engine.render(0, 1)).toMatchObject({ message: "The tool was closed." });
  });
});
