import { describe, expect, it, vi } from "vitest";
import {
  COMPARE_CANCELLED,
  CompareEngine,
  type CompareWorkerClient,
} from "./compare-engine";
import type { CompareRequest, CompareWorkerResult } from "./messages";

describe("CompareEngine", () => {
  it("opens both sides, cancels aborted renders, and recovers transparently after a worker crash", async () => {
    const clients: CompareWorkerClient[] = [];
    let crashNextRender = true;

    const createClient = (): CompareWorkerClient => {
      const client: CompareWorkerClient = {
        request: vi.fn(async (req: CompareRequest): Promise<CompareWorkerResult> => {
          if (req.op === "open") {
            return {
              status: "opened",
              side: req.side,
              pageCount: 1,
              scannedPages: 0,
              summary: null,
            };
          }
          if (req.op === "render") {
            if (crashNextRender) {
              crashNextRender = false;
              throw new Error("worker died");
            }
            return {
              status: "rendered",
              width: req.width,
              height: 100,
              pixels: new ArrayBuffer(4),
            };
          }
          if (req.op === "visual-diff") {
            return {
              status: "visual-diff",
              pixels: new ArrayBuffer(4),
              summary: {
                pairIndex: req.pairIndex,
                width: 100,
                height: 100,
                leftWidth: 100,
                leftHeight: 100,
                rightWidth: 100,
                rightHeight: 100,
                sizeMismatch: false,
                changedPixels: 0,
                totalPixels: 10000,
                percentChanged: 0,
                regions: [],
              },
            };
          }
          if (req.op === "build-report") {
            return { status: "report", data: new ArrayBuffer(8) };
          }
          return { status: "closed" };
        }),
        terminate: vi.fn(),
      };
      clients.push(client);
      return client;
    };

    const engine = new CompareEngine(createClient);

    await engine.openSide("left", "a.pdf", new ArrayBuffer(4), "");
    await engine.openSide("right", "b.pdf", new ArrayBuffer(4), "");

    // Aborted render returns COMPARE_CANCELLED without hitting worker
    const ac = new AbortController();
    ac.abort();
    expect(await engine.renderPage("left", 0, 200, ac.signal)).toEqual(
      COMPARE_CANCELLED,
    );

    // First render crashes worker #1
    const crashed = await engine.renderPage("left", 0, 200);
    expect(crashed.status).toBe("error");
    expect(clients[0].terminate).toHaveBeenCalledTimes(1);

    // Next render spawns worker #2, re-opens both sides, and succeeds
    const recovered = await engine.renderPage("left", 0, 200);
    expect(recovered.status).toBe("rendered");
    expect(clients).toHaveLength(2);
    expect(clients[1].request).toHaveBeenCalledWith(
      expect.objectContaining({ op: "open", side: "left" }),
      expect.any(Object),
    );
    expect(clients[1].request).toHaveBeenCalledWith(
      expect.objectContaining({ op: "open", side: "right" }),
      expect.any(Object),
    );

    expect((await engine.computeVisualDiff(0, 200)).status).toBe("visual-diff");
    expect((await engine.buildReport()).status).toBe("report");

    await engine.closeSide("left");
    await engine.closeAll();
    engine.dispose();

    const afterDispose = await engine.renderPage("left", 0, 100);
    expect(afterDispose.status).toBe("error");
  });
});
