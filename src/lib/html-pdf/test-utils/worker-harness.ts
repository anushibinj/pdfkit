/**
 * Test-only harness that runs a conversion worker's real module code in Node:
 * a fake dedicated-worker global scope, and a temporary site directory that
 * serves the real ironpress files under /wasm/, as the deployed site does.
 * Node only (uses fs).
 */
import { copyFile, mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { vi } from "vitest";
import type { WorkerResponse } from "@/lib/worker-protocol";

/** A fake `self` plus a way to send it requests. */
export interface FakeWorkerScope {
  /** Install with `vi.stubGlobal("self", scope.self)` before importing. */
  self: {
    location: { origin: string };
    addEventListener(
      type: "message",
      listener: (e: MessageEvent) => void,
    ): void;
    postMessage(message: unknown, transfer?: Transferable[]): void;
  };
  /** Every message the worker posted, with its transfer list. */
  posted: { message: WorkerResponse<unknown>; transfer?: Transferable[] }[];
  /**
   * Deliver one request and wait for its final answer (progress messages are
   * kept in {@link FakeWorkerScope.posted} but not returned).
   */
  request<Res>(
    payload: unknown,
  ): Promise<{ result: Res; transfer?: Transferable[] }>;
}

/**
 * Create a fake dedicated-worker global scope for a given site origin.
 *
 * `exposeWorker` registers a "message" listener on `self` and answers with
 * `self.postMessage`; this fake records both, so a test can drive the worker
 * exactly like `WorkerClient` does, by request id.
 *
 * @param origin The site origin the worker sees in `self.location.origin`.
 * @returns The scope and its helpers.
 */
export function createFakeWorkerScope(origin: string): FakeWorkerScope {
  const listeners: ((e: MessageEvent) => void)[] = [];
  const posted: FakeWorkerScope["posted"] = [];
  let nextId = 1;
  return {
    self: {
      location: { origin },
      addEventListener: (_type, listener) => listeners.push(listener),
      postMessage: (message, transfer) =>
        posted.push({ message: message as WorkerResponse<unknown>, transfer }),
    },
    posted,
    async request<Res>(payload: unknown) {
      const id = nextId++;
      for (const listener of listeners) {
        listener({ data: { id, payload } } as MessageEvent);
      }
      const answer = await vi.waitFor(
        () => {
          const found = posted.find(
            (p) => p.message.id === id && p.message.type !== "progress",
          );
          if (!found) throw new Error(`no answer to request ${id} yet`);
          return found;
        },
        { timeout: 60_000, interval: 20 },
      );
      if (answer.message.type === "error") {
        throw new Error(answer.message.error.message);
      }
      if (answer.message.type !== "result") throw new Error("unreachable");
      return {
        result: answer.message.payload as Res,
        transfer: answer.transfer,
      };
    },
  };
}

/** A temporary site directory; remove it with `dispose`. */
export interface FakeSite {
  /** `file:` URL of the site root, used as the worker's origin */
  origin: string;
  dispose(): Promise<void>;
}

/**
 * Lay out a temporary site root. With `withEngine`, `/wasm/` holds the real
 * ironpress glue and binary from node_modules, as `scripts/copy-wasm.mjs`
 * places them for the deployed site; without it, `/wasm/` is missing, like a
 * site whose engine failed to download.
 *
 * The glue loads its binary with `fetch`, which Node does not support for
 * `file:` URLs, so `fetch` is stubbed to read local files; restore it with
 * `vi.unstubAllGlobals()`.
 *
 * @param withEngine Whether to provide the ironpress files.
 * @returns The site's origin and a cleanup function.
 */
export async function createFakeSite(withEngine: boolean): Promise<FakeSite> {
  const root = await mkdtemp(path.join(tmpdir(), "pdfkit-site-"));
  if (withEngine) {
    const require = createRequire(import.meta.url);
    const pkg = path.dirname(require.resolve("ironpress/package.json"));
    await mkdir(path.join(root, "wasm"));
    for (const file of ["ironpress.js", "ironpress_bg.wasm"]) {
      await copyFile(path.join(pkg, file), path.join(root, "wasm", file));
    }
  }
  vi.stubGlobal("fetch", async (url: string | URL) => {
    const bytes = await readFile(new URL(String(url)));
    return new Response(bytes, {
      headers: { "Content-Type": "application/wasm" },
    });
  });
  return {
    // A file: URL has no real "origin"; the worker only appends "/wasm/".
    origin: pathToFileURL(root).href,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}
