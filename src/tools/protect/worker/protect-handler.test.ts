import { describe, expect, it, vi } from "vitest";
import { retryableOnce } from "@/lib/retryable-once";
import type { ProtectRequest } from "../messages";
import {
  createProtectHandler,
  toCrashResult,
  toProtectResult,
  type Protector,
} from "./protect-handler";

const request = (): ProtectRequest => ({
  data: new Uint8Array([37, 80, 68, 70]).buffer,
  password: "pw",
});
const ctx = () => ({ progress: vi.fn() });

describe("toProtectResult", () => {
  it("transfers the protected PDF's buffer", () => {
    const out = toProtectResult({
      kind: "protected",
      pdf: new Uint8Array([1, 2, 3]),
      replacedRestrictions: true,
      invalidatedSignatures: 2,
      warnings: "repaired",
    });
    expect(out.result).toMatchObject({
      status: "protected",
      replacedRestrictions: true,
      invalidatedSignatures: 2,
      warnings: "repaired",
    });
    if (out.result.status !== "protected") throw new Error("unreachable");
    expect(Array.from(new Uint8Array(out.result.data))).toEqual([1, 2, 3]);
    expect(out.transfer).toEqual([out.result.data]);
  });

  it("copies a view into a larger buffer before transferring", () => {
    const memory = new Uint8Array([9, 1, 2, 9]);
    const out = toProtectResult({
      kind: "protected",
      pdf: memory.subarray(1, 3),
      replacedRestrictions: false,
      invalidatedSignatures: 0,
    });
    if (out.result.status !== "protected") throw new Error("unreachable");
    expect(out.result.data).not.toBe(memory.buffer);
    expect(out.result.data.byteLength).toBe(2);
  });

  it("maps already-protected and failures", () => {
    expect(toProtectResult({ kind: "already-protected" })).toEqual({
      result: { status: "already-protected" },
    });
    expect(toProtectResult({ kind: "failed", message: "bad" })).toEqual({
      result: { status: "error", reason: "failed", message: "bad" },
    });
  });
});

describe("toCrashResult", () => {
  it("classifies memory exhaustion", () => {
    expect(
      toCrashResult(new RangeError("Array buffer allocation failed")).reason,
    ).toBe("out-of-memory");
  });

  it("reports other crashes as failures with the detail", () => {
    const result = toCrashResult(new Error("unreachable executed"));
    expect(result.reason).toBe("failed");
    expect(result.message).toContain("unreachable executed");
  });
});

describe("createProtectHandler", () => {
  it("protects the request's bytes with its password", async () => {
    const protect = vi.fn(() => ({
      kind: "protected" as const,
      pdf: new Uint8Array([7]),
      replacedRestrictions: false,
      invalidatedSignatures: 0,
    }));
    const c = ctx();
    const out = await createProtectHandler(
      retryableOnce(async () => ({ protect })),
    )(request(), c);
    expect(protect).toHaveBeenCalledWith(
      new Uint8Array([37, 80, 68, 70]),
      "pw",
    );
    expect(out.result.status).toBe("protected");
    expect(c.progress).toHaveBeenCalled();
  });

  it("treats a missing or non-string password as empty", async () => {
    const protect = vi.fn(() => ({
      kind: "failed" as const,
      message: "Enter a password.",
    }));
    await createProtectHandler(retryableOnce(async () => ({ protect })))(
      { data: new ArrayBuffer(1), password: 42 as unknown as string },
      ctx(),
    );
    expect(protect).toHaveBeenCalledWith(expect.any(Uint8Array), "");
  });

  it("reports a failure to load the engine", async () => {
    const out = await createProtectHandler(
      retryableOnce<Protector>(async () => {
        throw new Error("Failed to fetch");
      }),
    )(request(), ctx());
    expect(out.result).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: Failed to fetch",
    });
  });

  it("starts a fresh engine after a crash", async () => {
    let loads = 0;
    const handler = createProtectHandler(
      retryableOnce<Protector>(async () => {
        loads++;
        return {
          protect: () => {
            if (loads === 1) throw new Error("Aborted(OOM)");
            return { kind: "already-protected" };
          },
        };
      }),
    );
    expect((await handler(request(), ctx())).result).toMatchObject({
      status: "error",
      reason: "out-of-memory",
    });
    expect((await handler(request(), ctx())).result).toEqual({
      status: "already-protected",
    });
    expect(loads).toBe(2);
  });
});
