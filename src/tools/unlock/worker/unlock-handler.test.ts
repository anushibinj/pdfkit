import { describe, expect, it, vi } from "vitest";
import type { QpdfCommands, QpdfWorkspace } from "@/lib/qpdf/qpdf-runner";
import { createUnlockHandler, toUnlockFailure } from "./unlock-handler";

const ctx = () => ({ progress: vi.fn() });
const data = new Uint8Array([1]).buffer;

/** A qpdf that decrypts anything (exit 0, output present). */
function workingQpdf(): QpdfCommands {
  const job: QpdfWorkspace = {
    path: (name) => `/job-1-${name}`,
    write: (name) => `/job-1-${name}`,
    read: () => new Uint8Array([9, 9]),
    exists: () => true,
  };
  return {
    run: vi.fn(() => ({ code: 0, stdout: "", stderr: "" })),
    withJob: (fn) => fn(job),
  };
}

describe("toUnlockFailure", () => {
  it("gives memory exhaustion its own reason", () => {
    expect(toUnlockFailure(new RangeError("x")).reason).toBe("out-of-memory");
  });

  it("passes other errors through", () => {
    expect(toUnlockFailure("boom")).toEqual({
      status: "error",
      reason: "failed",
      message: "boom",
    });
  });
});

describe("createUnlockHandler", () => {
  it("unlocks and transfers the result's buffer", async () => {
    const c = ctx();
    const handler = createUnlockHandler(async () => workingQpdf(), vi.fn());
    const out = await handler({ data, password: "pw" }, c);
    expect(out.result.status).toBe("unlocked");
    if (out.result.status !== "unlocked") throw new Error("unreachable");
    expect(out.transfer).toEqual([out.result.data]);
    expect(c.progress).toHaveBeenCalledWith(0.1, "Starting");
  });

  it("transfers nothing for results without a file", async () => {
    const qpdf = workingQpdf();
    vi.mocked(qpdf.run).mockReturnValue({ code: 2, stdout: "", stderr: "" });
    const out = await createUnlockHandler(async () => qpdf, vi.fn())(
      { data },
      ctx(),
    );
    expect(out.result).toEqual({ status: "not-encrypted" });
    expect(out.transfer).toEqual([]);
  });

  it("reports an engine that cannot be loaded", async () => {
    const reset = vi.fn();
    const out = await createUnlockHandler(async () => {
      throw new Error("Failed to fetch");
    }, reset)({ data }, ctx());
    expect(out.result).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: Failed to fetch",
    });
    expect(reset).not.toHaveBeenCalled();
  });

  it("drops qpdf after a crash so the next request loads a fresh one", async () => {
    const qpdf = workingQpdf();
    vi.mocked(qpdf.run).mockImplementation(() => {
      throw new WebAssembly.RuntimeError("unreachable");
    });
    const reset = vi.fn();
    const out = await createUnlockHandler(async () => qpdf, reset)(
      { data },
      ctx(),
    );
    expect(reset).toHaveBeenCalledOnce();
    expect(out.result).toEqual({
      status: "error",
      reason: "failed",
      message: "unreachable",
    });
  });
});
