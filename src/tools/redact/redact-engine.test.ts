import { describe, expect, it, vi } from "vitest";
import { CANCELLED, RedactEngine, type RedactWorkerClient } from "./redact-engine";
import type { RedactRequest, RedactWorkerResult } from "./messages";

function fakeClient(
  handler: (req: RedactRequest) => Promise<RedactWorkerResult>,
): RedactWorkerClient {
  return {
    request: vi.fn((req) => handler(req)),
    terminate: vi.fn(),
  };
}

describe("RedactEngine", () => {
  it("opens, renders, extracts text, searches, applies redactions, and closes cleanly", async () => {
    const client = fakeClient(async (req) => {
      switch (req.op) {
        case "open":
          return {
            status: "opened",
            pages: [
              { box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 },
            ],
          };
        case "render":
          return {
            status: "rendered",
            width: 10,
            height: 10,
            pixels: new ArrayBuffer(400),
          };
        case "text-under-box":
          return { status: "text-extracted", text: "SSN" };
        case "search":
          return { status: "searched", matches: [] };
        case "apply":
          return {
            status: "redacted",
            data: new ArrayBuffer(8),
            report: {
              pagesRedacted: 1,
              marksApplied: 1,
              textObjectsRemoved: 1,
              textObjectsSplit: 0,
              imagesModified: 0,
              pathsRemoved: 0,
              annotationsRemoved: 0,
              pagesRasterized: 0,
              sanitize: {
                metadataEntriesRemoved: 0,
                xmpStreamsRemoved: 0,
                attachmentsRemoved: 0,
                javascriptActionsRemoved: 0,
                hiddenLayersRemoved: 0,
                bookmarksCleaned: 0,
                annotationsRemoved: 0,
                formValuesCleared: 0,
                objectsPruned: 0,
              },
              verification: {
                verified: true,
                totalTerms: 1,
                remainingTerms: 0,
                leakedTerms: [],
                summary: "0 of 1 redacted terms remain",
              },
            },
          };
        case "close":
          return { status: "closed" };
      }
    });

    const engine = new RedactEngine(() => client);
    expect((await engine.open(new ArrayBuffer(10))).status).toBe("opened");
    expect((await engine.render(0, 400)).status).toBe("rendered");
    expect(
      (
        await engine.textUnderBox(0, {
          left: 0,
          bottom: 0,
          right: 10,
          top: 10,
        })
      ).status,
    ).toBe("text-extracted");
    expect(
      (await engine.search({ mode: "presets", presets: ["email"] })).status,
    ).toBe("searched");
    expect(
      (
        await engine.applyRedactions({
          marks: [],
          style: { fill: "black", label: "REDACTED" },
          cleanup: {
            metadata: true,
            attachments: true,
            javascript: true,
            hiddenLayers: true,
            bookmarks: true,
          },
          rasterizePages: false,
        })
      ).status,
    ).toBe("redacted");
    await engine.close();
    engine.dispose();
  });

  it("skips aborted renders and reopens transparently after a worker crash", async () => {
    let instanceCount = 0;
    const engine = new RedactEngine(() => {
      const id = ++instanceCount;
      return fakeClient(async (req) => {
        if (id === 1 && req.op === "search") {
          throw new Error("worker died");
        }
        if (req.op === "open") {
          return {
            status: "opened",
            pages: [
              { box: { left: 0, bottom: 0, right: 612, top: 792 }, rotation: 0 },
            ],
          };
        }
        return { status: "searched", matches: [] };
      });
    });

    await engine.open(new ArrayBuffer(4), "pw");

    const controller = new AbortController();
    controller.abort();
    expect(await engine.render(0, 200, controller.signal)).toBe(CANCELLED);

    const crashed = await engine.search({ mode: "presets", presets: ["pan"] });
    expect(crashed.status).toBe("error");

    const recovered = await engine.search({ mode: "presets", presets: ["pan"] });
    expect(recovered.status).toBe("searched");
    expect(instanceCount).toBe(2);
  });
});
