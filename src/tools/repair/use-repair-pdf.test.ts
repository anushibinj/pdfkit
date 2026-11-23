import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RepairReport } from "./core/model";
import type { RepairClient } from "./repair-client";
import { useRepairPdf } from "./use-repair-pdf";

const sampleReport: RepairReport = {
  headerRepaired: true,
  eofRepaired: true,
  xrefReconstructed: true,
  trailerReconstructed: false,
  objectsRecovered: 5,
  streamsRepaired: 0,
  pagesRecovered: 2,
  issues: ["Recovered 5 objects"],
};

function createMockClient(): {
  client: RepairClient;
  repairMock: ReturnType<typeof vi.fn>;
  terminateMock: ReturnType<typeof vi.fn>;
} {
  const repairMock = vi.fn();
  const terminateMock = vi.fn();
  const client: RepairClient = {
    repair: repairMock,
    terminate: terminateMock,
  };
  return { client, repairMock, terminateMock };
}

describe("useRepairPdf", () => {
  it("initializes in idle state", () => {
    const { client } = createMockClient();
    const { result } = renderHook(() => useRepairPdf(() => client));

    expect(result.current.state).toEqual({ kind: "idle" });
  });

  it("stages a file when selectFile is called", () => {
    const { client } = createMockClient();
    const { result } = renderHook(() => useRepairPdf(() => client));

    const file = new File(["test"], "sample.pdf", { type: "application/pdf" });
    act(() => {
      result.current.selectFile(file);
    });

    expect(result.current.state).toEqual({ kind: "ready", file });
  });

  it("resets to idle when clear is called", () => {
    const { client, terminateMock } = createMockClient();
    const { result } = renderHook(() => useRepairPdf(() => client));

    const file = new File(["test"], "sample.pdf", { type: "application/pdf" });
    act(() => {
      result.current.selectFile(file);
    });
    act(() => {
      result.current.clear();
    });

    expect(result.current.state).toEqual({ kind: "idle" });
    expect(terminateMock).toHaveBeenCalled();
  });

  it("handles successful repair workflow", async () => {
    const { client, repairMock } = createMockClient();
    repairMock.mockResolvedValue({
      status: "repaired",
      data: new ArrayBuffer(8),
      pageCount: 2,
      report: sampleReport,
    });

    const { result } = renderHook(() => useRepairPdf(() => client));
    const file = new File(["test"], "sample.pdf", { type: "application/pdf" });

    act(() => {
      result.current.selectFile(file);
    });

    await act(async () => {
      await result.current.repair();
    });

    expect(result.current.state.kind).toBe("repaired");
    if (result.current.state.kind === "repaired") {
      expect(result.current.state.pageCount).toBe(2);
      expect(result.current.state.report).toEqual(sampleReport);
      expect(result.current.state.pdf).toBeInstanceOf(Blob);
    }
  });

  it("handles password-required response", async () => {
    const { client, repairMock } = createMockClient();
    repairMock.mockResolvedValue({
      status: "password-required",
    });

    const { result } = renderHook(() => useRepairPdf(() => client));
    const file = new File(["test"], "locked.pdf", { type: "application/pdf" });

    act(() => {
      result.current.selectFile(file);
    });

    await act(async () => {
      await result.current.repair();
    });

    expect(result.current.state.kind).toBe("password-required");
  });

  it("handles unrecoverable response", async () => {
    const { client, repairMock } = createMockClient();
    repairMock.mockResolvedValue({
      status: "unrecoverable",
      reason: "No indirect objects salvaged",
    });

    const { result } = renderHook(() => useRepairPdf(() => client));
    const file = new File(["test"], "corrupt.pdf", { type: "application/pdf" });

    act(() => {
      result.current.selectFile(file);
    });

    await act(async () => {
      await result.current.repair();
    });

    expect(result.current.state.kind).toBe("unrecoverable");
    if (result.current.state.kind === "unrecoverable") {
      expect(result.current.state.reason).toContain("No indirect objects salvaged");
    }
  });

  it("ignores late response when cancelled", async () => {
    const { client, repairMock, terminateMock } = createMockClient();
    let resolveRepair: (value: unknown) => void = () => {};
    repairMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRepair = resolve;
        }),
    );

    const { result } = renderHook(() => useRepairPdf(() => client));
    const file = new File(["test"], "slow.pdf", { type: "application/pdf" });

    act(() => {
      result.current.selectFile(file);
    });

    // Start repair without awaiting
    act(() => {
      result.current.repair();
    });

    expect(result.current.state.kind).toBe("repairing");

    // Cancel while in flight
    act(() => {
      result.current.cancel();
    });

    expect(result.current.state.kind).toBe("ready");
    expect(terminateMock).toHaveBeenCalled();

    // Now late resolve
    await act(async () => {
      resolveRepair({
        status: "repaired",
        data: new ArrayBuffer(4),
        pageCount: 1,
        report: sampleReport,
      });
    });

    // Should remain ready, not transitioned to repaired
    expect(result.current.state.kind).toBe("ready");
  });
});
