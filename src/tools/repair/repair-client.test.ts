import { describe, expect, it, vi } from "vitest";
import type { RepairWorkerResult } from "./messages";
import { WorkerRepairClient, type RepairRequestSender } from "./repair-client";

describe("WorkerRepairClient", () => {
  it("dispatches repair request, transfers buffer, and handles progress", async () => {
    let capturedOnProgress: ((progress: number, stage?: string) => void) | undefined;

    const sender: RepairRequestSender = {
      request: vi.fn().mockImplementation((payload, options) => {
        capturedOnProgress = options?.onProgress;
        return Promise.resolve({
          status: "repaired",
          data: new ArrayBuffer(4),
          pageCount: 1,
          report: {
            headerRepaired: false,
            eofRepaired: false,
            xrefReconstructed: true,
            trailerReconstructed: false,
            objectsRecovered: 2,
            streamsRepaired: 0,
            pagesRecovered: 1,
            issues: [],
          },
        } as RepairWorkerResult);
      }),
      terminate: vi.fn(),
    };

    const client = new WorkerRepairClient(sender);
    const buffer = new ArrayBuffer(8);
    const progressSpy = vi.fn();

    const result = await client.repair(
      buffer,
      "broken.pdf",
      "secret",
      progressSpy,
    );

    expect(sender.request).toHaveBeenCalledWith(
      {
        op: "repair",
        data: buffer,
        filename: "broken.pdf",
        password: "secret",
      },
      expect.objectContaining({
        transfer: [buffer],
      }),
    );

    // Verify progress forwarding
    expect(capturedOnProgress).toBeDefined();
    capturedOnProgress?.(0.5, "Rebuilding");
    expect(progressSpy).toHaveBeenCalledWith(0.5, "Rebuilding");

    expect(result.status).toBe("repaired");
  });

  it("terminates sender when terminate is called", () => {
    const sender: RepairRequestSender = {
      request: vi.fn(),
      terminate: vi.fn(),
    };

    const client = new WorkerRepairClient(sender);
    client.terminate();

    expect(sender.terminate).toHaveBeenCalled();
  });
});
