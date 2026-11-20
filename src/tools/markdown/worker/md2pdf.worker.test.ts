// @vitest-environment node
/**
 * Runs the real worker module (its top-level wiring) against a fake worker
 * scope and the real ironpress files served from a temporary /wasm/.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSite,
  createFakeWorkerScope,
  type FakeSite,
} from "@/lib/html-pdf/test-utils/worker-harness";
import type { ConvertResult } from "@/lib/html-pdf/types";
import type { ConvertRequest } from "../messages";

const request: ConvertRequest = {
  markdown: "# Hello\n\nSome *text*.",
  css: "h1 { color: #ff0000; }",
  page: { size: "Letter", marginMm: 20 },
};

let site: FakeSite | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.resetModules();
  await site?.dispose();
  site = undefined;
});

/** Start a fresh copy of the worker module on a fake scope for `origin`. */
async function startWorker(origin: string) {
  const scope = createFakeWorkerScope(origin);
  vi.stubGlobal("self", scope.self);
  await import("./md2pdf.worker");
  return scope;
}

describe("md2pdf.worker", () => {
  it("loads ironpress from /wasm/ and answers with a transferred PDF", async () => {
    site = await createFakeSite(true);
    const scope = await startWorker(site.origin);
    const { result, transfer } = await scope.request<ConvertResult>(request);
    expect(result.status).toBe("converted");
    if (result.status !== "converted") throw new Error("unreachable");
    const head = new TextDecoder().decode(new Uint8Array(result.data, 0, 5));
    expect(head).toBe("%PDF-");
    // The PDF's buffer is transferred, not copied.
    expect(transfer).toEqual([result.data]);
    // Progress was reported before the answer.
    expect(scope.posted[0].message).toMatchObject({ type: "progress" });
  }, 60_000);

  it("reports a missing engine as a failed result, not a crash", async () => {
    site = await createFakeSite(false);
    const scope = await startWorker(site.origin);
    const { result } = await scope.request<ConvertResult>(request);
    expect(result).toMatchObject({ status: "error", reason: "failed" });
    if (result.status !== "error") throw new Error("unreachable");
    expect(result.message).toMatch(/^Could not load the PDF engine: /);
  });
});
