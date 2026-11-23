import { describe, expect, it, vi } from "vitest";
import type { HandlerContext } from "@/lib/worker-protocol";
import type { RepairReport } from "../core/model";
import { createRepairHandler, type RepairWorkerSession } from "./repair-handler";

function createMockContext(): HandlerContext {
  return {
    progress: vi.fn(),
  };
}

const sampleReport: RepairReport = {
  headerRepaired: true,
  eofRepaired: true,
  xrefReconstructed: true,
  trailerReconstructed: false,
  objectsRecovered: 10,
  streamsRepaired: 0,
  pagesRecovered: 2,
  issues: ["Fixed header"],
};

describe("createRepairHandler", () => {
  it("answers ping with pong", async () => {
    const handler = createRepairHandler(async () => ({} as RepairWorkerSession));
    const ctx = createMockContext();

    const response = await handler({ op: "ping" }, ctx);
    expect(response.result).toEqual({ status: "pong" });
    expect(response.transfer).toBeUndefined();
  });

  it("returns error on unknown operation", async () => {
    const handler = createRepairHandler(async () => ({} as RepairWorkerSession));
    const ctx = createMockContext();

    // @ts-expect-error Testing invalid operation
    const response = await handler({ op: "invalid" }, ctx);
    expect(response.result).toEqual({
      status: "error",
      message: "Unknown operation: invalid",
    });
  });

  it("handles successful repair and transfers buffer", async () => {
    const repairedPdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const session: RepairWorkerSession = {
      repair: vi.fn().mockResolvedValue({
        kind: "repaired",
        pdf: repairedPdf,
        pageCount: 2,
        report: sampleReport,
      }),
    };

    const handler = createRepairHandler(async () => session);
    const ctx = createMockContext();

    const inputData = new ArrayBuffer(8);
    const response = await handler(
      { op: "repair", data: inputData, filename: "corrupt.pdf" },
      ctx,
    );

    expect(ctx.progress).toHaveBeenCalledTimes(3);
    expect(response.result.status).toBe("repaired");
    if (response.result.status === "repaired") {
      expect(response.result.pageCount).toBe(2);
      expect(response.result.report).toEqual(sampleReport);
      expect(new Uint8Array(response.result.data)).toEqual(repairedPdf);
      expect(response.transfer).toEqual([response.result.data]);
    }
  });

  it("handles password-required outcome", async () => {
    const session: RepairWorkerSession = {
      repair: vi.fn().mockResolvedValue({
        kind: "password-required",
      }),
    };

    const handler = createRepairHandler(async () => session);
    const ctx = createMockContext();

    const response = await handler(
      { op: "repair", data: new ArrayBuffer(4), filename: "locked.pdf" },
      ctx,
    );

    expect(response.result).toEqual({ status: "password-required" });
  });

  it("handles unrecoverable document outcome", async () => {
    const session: RepairWorkerSession = {
      repair: vi.fn().mockResolvedValue({
        kind: "failed",
        message: "No objects found",
      }),
    };

    const handler = createRepairHandler(async () => session);
    const ctx = createMockContext();

    const response = await handler(
      { op: "repair", data: new ArrayBuffer(4), filename: "corrupt.pdf" },
      ctx,
    );

    expect(response.result).toEqual({
      status: "unrecoverable",
      reason: "No objects found",
    });
  });

  it("handles thrown out-of-memory error", async () => {
    const session: RepairWorkerSession = {
      repair: vi.fn().mockRejectedValue(new RangeError("Out of memory")),
    };

    const handler = createRepairHandler(async () => session);
    const ctx = createMockContext();

    const response = await handler(
      { op: "repair", data: new ArrayBuffer(4), filename: "huge.pdf" },
      ctx,
    );

    expect(response.result.status).toBe("error");
    if (response.result.status === "error") {
      expect(response.result.message).toContain("out of memory");
    }
  });

  it("handles unexpected thrown error", async () => {
    const session: RepairWorkerSession = {
      repair: vi.fn().mockRejectedValue(new Error("Disk read failed")),
    };

    const handler = createRepairHandler(async () => session);
    const ctx = createMockContext();

    const response = await handler(
      { op: "repair", data: new ArrayBuffer(4), filename: "test.pdf" },
      ctx,
    );

    expect(response.result).toEqual({
      status: "error",
      message: "Disk read failed",
    });
  });
});
