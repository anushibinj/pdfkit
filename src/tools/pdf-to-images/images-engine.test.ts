import { describe, expect, it, vi } from "vitest";
import type { RequestOptions } from "@/lib/worker-client";
import { ImagesEngine, type ImagesWorkerClient } from "./images-engine";
import type { ImagesRequest, ImagesResult } from "./messages";

const options = { format: "png" as const, dpi: 150, quality: 0.9 };

/** A worker client that answers with `respond` and records requests. */
function fakeClient(respond: (request: ImagesRequest) => ImagesResult | Error) {
  const requests: { payload: ImagesRequest; options?: RequestOptions }[] = [];
  const client: ImagesWorkerClient & { terminated: boolean } = {
    terminated: false,
    request: vi.fn(async (payload, opts) => {
      requests.push({ payload, options: opts });
      const answer = respond(payload);
      if (answer instanceof Error) throw answer;
      return answer;
    }),
    terminate: vi.fn(function (this: { terminated: boolean }) {
      client.terminated = true;
    }),
  };
  return { client, requests };
}

const opened: ImagesResult = { status: "opened", pageCount: 3 };
const page: ImagesResult = {
  status: "page",
  pageIndex: 0,
  width: 1,
  height: 1,
  dpi: 72,
  reduced: false,
  mimeType: "image/png",
  data: new ArrayBuffer(1),
};

describe("ImagesEngine", () => {
  it("opens with a transferred copy and keeps the original", async () => {
    const { client, requests } = fakeClient(() => opened);
    const engine = new ImagesEngine(() => client);
    const data = new Uint8Array([1, 2]).buffer;
    expect(await engine.open(data, "pw")).toEqual(opened);
    const sent = requests[0];
    expect(sent.payload).toMatchObject({ op: "open", password: "pw" });
    const copy = (sent.payload as { data: ArrayBuffer }).data;
    expect(copy).not.toBe(data);
    expect(sent.options?.transfer).toEqual([copy]);
    expect(data.byteLength).toBe(2); // the original is untouched
  });

  it("creates the worker lazily, once", async () => {
    const { client } = fakeClient(() => opened);
    const create = vi.fn(() => client);
    const engine = new ImagesEngine(create);
    expect(create).not.toHaveBeenCalled();
    await engine.open(new ArrayBuffer(1));
    await engine.renderPage(0, options);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("sends page requests with their parameters", async () => {
    const { client, requests } = fakeClient((r) =>
      r.op === "open"
        ? opened
        : r.op === "render-page"
          ? page
          : { status: "images", pageIndex: 1, entries: [] },
    );
    const engine = new ImagesEngine(() => client);
    await engine.open(new ArrayBuffer(1));
    expect(await engine.renderPage(0, options)).toEqual(page);
    const keys = ["a"];
    await engine.extractImages(1, keys);
    expect(requests[1].payload).toEqual({
      op: "render-page",
      pageIndex: 0,
      options,
    });
    expect(requests[2].payload).toEqual({
      op: "extract-images",
      pageIndex: 1,
      knownKeys: ["a"],
    });
    expect((requests[2].payload as { knownKeys: string[] }).knownKeys).not.toBe(
      keys,
    );
  });

  it("restarts a dead worker and re-opens the file before the next request", async () => {
    let calls = 0;
    const clients: ReturnType<typeof fakeClient>[] = [];
    const create = vi.fn(() => {
      const fake = fakeClient((r) => {
        if (r.op === "open") return opened;
        calls++;
        return calls === 1 ? new Error("worker died") : page;
      });
      clients.push(fake);
      return fake.client;
    });
    const engine = new ImagesEngine(create);
    await engine.open(new Uint8Array([7]).buffer, "pw");
    const failed = await engine.renderPage(0, options);
    expect(failed).toMatchObject({ status: "error", reason: "crashed" });
    expect(failed.status === "error" && failed.message).toMatch(/worker died/);
    expect(clients[0].client.terminate).toHaveBeenCalled();

    expect(await engine.renderPage(0, options)).toEqual(page);
    expect(create).toHaveBeenCalledTimes(2);
    expect(clients[1].requests.map((r) => r.payload.op)).toEqual([
      "open",
      "render-page",
    ]);
    expect(clients[1].requests[0].payload).toMatchObject({ password: "pw" });
  });

  it("restarts after out-of-memory results but not after ordinary failures", async () => {
    const answers: ImagesResult[] = [
      opened,
      { status: "error", reason: "failed", message: "no such page" },
      { status: "error", reason: "out-of-memory", message: "oom" },
    ];
    const { client } = fakeClient(() => answers.shift() ?? page);
    const engine = new ImagesEngine(() => client);
    await engine.open(new ArrayBuffer(1));
    await engine.renderPage(9, options);
    expect(client.terminate).not.toHaveBeenCalled();
    await engine.renderPage(0, options);
    expect(client.terminate).toHaveBeenCalledTimes(1);
  });

  it("reports a failed re-open and forgets the file", async () => {
    let first = true;
    const ops: string[] = [];
    const create = vi.fn(
      () =>
        fakeClient((r) => {
          ops.push(r.op);
          if (r.op === "open") {
            if (first) {
              first = false;
              return opened;
            }
            return { status: "wrong-password" };
          }
          return new Error("died");
        }).client,
    );
    const engine = new ImagesEngine(create);
    await engine.open(new ArrayBuffer(1));
    await engine.renderPage(0, options); // the worker dies: stale
    expect(await engine.renderPage(0, options)).toMatchObject({
      status: "error",
      message: "Could not reopen the PDF. Open it again.",
    });
    // The file is forgotten: the next request is sent without re-opening.
    await engine.renderPage(0, options);
    expect(ops).toEqual(["open", "render-page", "open", "render-page"]);
  });

  it("runs requests in order even when issued together", async () => {
    const seen: string[] = [];
    const { client } = fakeClient((r) => {
      seen.push(r.op);
      return r.op === "open" ? opened : page;
    });
    const engine = new ImagesEngine(() => client);
    await Promise.all([
      engine.open(new ArrayBuffer(1)),
      engine.renderPage(0, options),
      engine.close(),
    ]);
    expect(seen).toEqual(["open", "render-page", "close"]);
  });

  it("close without a worker sends nothing; dispose answers every later request", async () => {
    const { client } = fakeClient(() => opened);
    const create = vi.fn(() => client);
    const engine = new ImagesEngine(create);
    await engine.close();
    expect(create).not.toHaveBeenCalled();
    await engine.open(new ArrayBuffer(1));
    engine.dispose();
    expect(client.terminate).toHaveBeenCalled();
    expect(await engine.renderPage(0, options)).toMatchObject({
      status: "error",
      message: "The tool was closed.",
    });
  });
});
