import { describe, expect, it, vi } from "vitest";
import { QpdfJob, type QpdfEngine, type QpdfRun } from "@/lib/qpdf/qpdf-runner";
import { retryableOnce } from "@/lib/retryable-once";
import type { UnlockRequest } from "../messages";
import { createUnlockHandler, toUnlockError, unlockPdf } from "./unlock-job";

/**
 * A qpdf engine that answers each command from a script: `answers[i]` is
 * the result of the i-th run. A decrypt run that "succeeds" writes `out`.
 */
function scriptedQpdf(answers: QpdfRun[], out = new Uint8Array([37, 80])) {
  const files = new Map<string, Uint8Array>();
  const runs: string[][] = [];
  const engine: QpdfEngine = {
    run: (args) => {
      runs.push([...args]);
      const answer = answers[runs.length - 1];
      if (args[0] === "--decrypt" && answer.code !== 2)
        files.set(args[args.length - 1], out);
      return answer;
    },
    writeFile: (path, bytes) => void files.set(path, bytes),
    readFile: (path) => files.get(path)!,
    exists: (path) => files.has(path),
    withJob: (fn) => {
      try {
        return fn(new QpdfJob("/job-1"));
      } finally {
        files.clear();
      }
    },
  };
  return { engine, runs, files };
}

const ok = (code = 0, stderr = ""): QpdfRun => ({ code, stdout: "", stderr });
const request = (password?: string): UnlockRequest => ({
  data: new Uint8Array([1, 2, 3]).buffer,
  password,
});

describe("unlockPdf", () => {
  it("decrypts right away when the file opens without a password (exit 3)", () => {
    const { engine, runs, files } = scriptedQpdf([ok(3), ok(0)]);
    const result = unlockPdf(engine, request());
    expect(runs).toEqual([
      ["--requires-password", "/job-1-in.pdf"],
      ["--decrypt", "/job-1-in.pdf", "/job-1-out.pdf"],
    ]);
    expect(result).toMatchObject({ status: "unlocked", via: "owner" });
    if (result.status !== "unlocked") throw new Error("unreachable");
    expect(Array.from(new Uint8Array(result.data))).toEqual([37, 80]);
    expect(result.warnings).toBeUndefined();
    expect(files.size).toBe(0); // cleaned up
  });

  it.each([
    ["exit 0", ok(0)],
    [
      "an invalid password message",
      ok(2, "qpdf: /job-1-in.pdf: invalid password"),
    ],
  ])("asks for a password on %s", (_name, probe) => {
    expect(unlockPdf(scriptedQpdf([probe]).engine, request())).toEqual({
      status: "password-required",
    });
  });

  it("reports an unencrypted file (exit 2 without a message)", () => {
    expect(unlockPdf(scriptedQpdf([ok(2)]).engine, request())).toEqual({
      status: "not-encrypted",
    });
  });

  it("explains a probe failure", () => {
    const result = unlockPdf(
      scriptedQpdf([ok(2, "qpdf: /job-1-in.pdf: can't find startxref")]).engine,
      request(),
    );
    expect(result).toEqual({
      status: "error",
      reason: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
  });

  it("passes a given password, skips the probe and keeps warnings", () => {
    const { engine, runs } = scriptedQpdf([
      ok(3, "WARNING: /job-1-in.pdf: object 5 0 damaged"),
    ]);
    const result = unlockPdf(engine, request("hunter2"));
    expect(runs).toEqual([
      ["--decrypt", "--password=hunter2", "/job-1-in.pdf", "/job-1-out.pdf"],
    ]);
    expect(result).toMatchObject({
      status: "unlocked",
      via: "password",
      warnings: "Object 5 0 damaged",
    });
  });

  it("reports a wrong password and other decrypt failures", () => {
    expect(
      unlockPdf(
        scriptedQpdf([ok(2, "qpdf: /job-1-in.pdf: invalid password")]).engine,
        request("x"),
      ),
    ).toEqual({ status: "wrong-password" });
    expect(
      unlockPdf(scriptedQpdf([ok(2, "qpdf: disk full")]).engine, request("x")),
    ).toEqual({ status: "error", reason: "failed", message: "Disk full" });
  });
});

describe("toUnlockError", () => {
  it("classifies memory exhaustion with advice", () => {
    expect(
      toUnlockError(new RangeError("Array buffer allocation failed")),
    ).toMatchObject({
      reason: "out-of-memory",
      message: expect.stringMatching(/ran out of memory/),
    });
  });

  it("passes other errors through", () => {
    expect(toUnlockError(new Error("boom"))).toEqual({
      status: "error",
      reason: "failed",
      message: "boom",
    });
  });
});

describe("createUnlockHandler", () => {
  const ctx = () => ({ progress: vi.fn() });

  it("unlocks and transfers the output buffer", async () => {
    const { engine } = scriptedQpdf([ok(3), ok(0)]);
    const c = ctx();
    const out = await createUnlockHandler(retryableOnce(async () => engine))(
      request(),
      c,
    );
    expect(c.progress).toHaveBeenCalledWith(0.1, "Starting");
    expect(out.result.status).toBe("unlocked");
    if (out.result.status !== "unlocked") throw new Error("unreachable");
    expect(out.transfer).toEqual([out.result.data]);
  });

  it("reports a failed engine load and retries it next time", async () => {
    const factory = vi
      .fn<() => Promise<QpdfEngine>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(scriptedQpdf([ok(2)]).engine);
    const handle = createUnlockHandler(retryableOnce(factory));
    expect((await handle(request(), ctx())).result).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: offline",
    });
    expect((await handle(request(), ctx())).result).toEqual({
      status: "not-encrypted",
    });
  });

  it("discards a qpdf instance that threw and reports the error", async () => {
    const broken: QpdfEngine = {
      ...scriptedQpdf([]).engine,
      withJob: () => {
        throw new WebAssembly.RuntimeError("unreachable");
      },
    };
    const qpdf = retryableOnce(async () => broken);
    const reset = vi.spyOn(qpdf, "reset");
    const out = await createUnlockHandler(qpdf)(request(), ctx());
    expect(out.result).toEqual({
      status: "error",
      reason: "failed",
      message: "unreachable",
    });
    expect(out.transfer).toEqual([]);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
