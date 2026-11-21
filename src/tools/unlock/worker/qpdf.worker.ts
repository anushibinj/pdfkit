/// <reference lib="webworker" />
import { errorMessage, isOutOfMemory } from "@/lib/errors";
import {
  EXIT_ERROR,
  EXIT_OK,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
} from "@/lib/qpdf/qpdf-output";
import { loadQpdf, type QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import { retryableOnce } from "@/lib/retryable-once";
import { toTransferableBuffer } from "@/lib/transfer";
import { exposeWorker } from "@/lib/worker-protocol";
import type { UnlockRequest, UnlockResult } from "../messages";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// qpdf is loaded once and reused; a failed load is retried on the next file.
const qpdfLoader = retryableOnce(() =>
  loadQpdf({
    wasmDir: WASM_DIR,
    // The glue is a static file in public/, not part of the bundle.
    importer: (url) =>
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
    console,
    fetch: (url) => fetch(url),
    wasm: WebAssembly,
  }),
);

let jobCounter = 0;

async function unlock({ data, password }: UnlockRequest): Promise<UnlockResult> {
  let qpdf: QpdfRunner;
  try {
    qpdf = await qpdfLoader.get();
  } catch (err) {
    return {
      status: "error",
      reason: "failed",
      message: `Could not load the PDF engine: ${errorMessage(err)}`,
    };
  }
  const job = `/job-${++jobCounter}-${Math.random().toString(36).slice(2, 8)}`;
  const input = `${job}-in.pdf`;
  const output = `${job}-out.pdf`;
  try {
    qpdf.writeFile(input, new Uint8Array(data));

    let via: "owner" | "password" = "password";
    if (password === undefined) {
      // Detect the encryption state first.
      const probe = qpdf.run(["--requires-password", input]);
      if (probe.code === EXIT_WARNINGS) {
        via = "owner"; // encrypted, but opens without a password
      } else if (probe.code === EXIT_OK || isInvalidPassword(probe.stderr)) {
        return { status: "password-required" };
      } else if (probe.stderr.trim() === "") {
        return { status: "not-encrypted" };
      } else {
        return {
          status: "error",
          reason: "failed",
          message: friendlyQpdfMessage(probe.stderr),
        };
      }
    }

    const args = ["--decrypt"];
    if (password !== undefined) args.push(`--password=${password}`);
    const res = qpdf.run([...args, input, output]);

    if (res.code === EXIT_ERROR || !qpdf.exists(output)) {
      if (isInvalidPassword(res.stderr)) return { status: "wrong-password" };
      return {
        status: "error",
        reason: "failed",
        message: friendlyQpdfMessage(res.stderr),
      };
    }

    // Transfer needs an ArrayBuffer of exactly the file's size.
    const out = toTransferableBuffer(qpdf.readFile(output));
    return {
      status: "unlocked",
      via,
      data: out,
      warnings:
        res.code === EXIT_WARNINGS ? friendlyQpdfMessage(res.stderr) : undefined,
    };
  } catch (err) {
    // After a crash or OOM the WASM instance is unreliable: start fresh next time.
    qpdfLoader.reset();
    if (isOutOfMemory(err)) {
      return {
        status: "error",
        reason: "out-of-memory",
        message:
          "The browser ran out of memory while processing this file. Try closing other tabs, or use a smaller file.",
      };
    }
    return {
      status: "error",
      reason: "failed",
      message: errorMessage(err),
    };
  } finally {
    qpdf.remove(input);
    qpdf.remove(output);
  }
}

exposeWorker<UnlockRequest, UnlockResult>(scope, async (req, ctx) => {
  ctx.progress(0.1, "Starting");
  const result = await unlock(req);
  const transfer = result.status === "unlocked" ? [result.data] : [];
  return { result, transfer };
});
