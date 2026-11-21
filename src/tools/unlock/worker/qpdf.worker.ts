/// <reference lib="webworker" />
import { instantiateWasmFromUrl, loadQpdf } from "@/lib/qpdf/load-qpdf";
import { probeEncryption } from "@/lib/qpdf/encryption-status";
import { StderrLog, type QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import {
  newScratchToken,
  removeScratchFiles,
  scratchFiles,
} from "@/lib/qpdf/scratch-files";
import { retryableOnce } from "@/lib/retryable-once";
import { toTransferableBuffer } from "@/lib/transfer";
import { exposeWorker } from "@/lib/worker-protocol";
import type { UnlockRequest, UnlockResult } from "../messages";
import {
  EXIT_ERROR,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
  isOutOfMemory,
} from "./qpdf-run";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

// One log for the worker's lifetime: every qpdf (re)load writes into it.
const stderr = new StderrLog();

/** Load qpdf once. Everything comes from our own origin (/wasm/). */
const qpdf = retryableOnce(() =>
  loadQpdf({
    wasmDir: WASM_DIR,
    // The glue code is a static file in public/, not part of the bundle.
    importModule: (url) =>
      import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
    instantiate: instantiateWasmFromUrl,
    console,
    stderr,
  }),
);

async function unlock({
  data,
  password,
}: UnlockRequest): Promise<UnlockResult> {
  let runner: QpdfRunner;
  try {
    runner = await qpdf.get();
  } catch (err) {
    return {
      status: "error",
      reason: "failed",
      message: `Could not load the PDF engine: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const files = scratchFiles(newScratchToken());
  try {
    runner.writeFile(files.input, new Uint8Array(data));

    let via: "owner" | "password" = "password";
    if (password === undefined) {
      // Detect the encryption state first.
      const status = probeEncryption(runner, files.input);
      switch (status.kind) {
        case "opens-without-password":
          via = "owner"; // encrypted, but opens without a password
          break;
        case "password-required":
          return { status: "password-required" };
        case "not-encrypted":
          return { status: "not-encrypted" };
        case "unreadable":
          return { status: "error", reason: "failed", message: status.message };
      }
    }

    const args = ["--decrypt"];
    if (password !== undefined) args.push(`--password=${password}`);
    const res = runner.run([...args, files.input, files.output]);

    if (res.code === EXIT_ERROR || !runner.exists(files.output)) {
      if (isInvalidPassword(res.stderr)) return { status: "wrong-password" };
      return {
        status: "error",
        reason: "failed",
        message: friendlyQpdfMessage(res.stderr),
      };
    }

    return {
      status: "unlocked",
      via,
      // Transfer needs an ArrayBuffer of exactly the file's size.
      data: toTransferableBuffer(runner.readFile(files.output)),
      warnings:
        res.code === EXIT_WARNINGS
          ? friendlyQpdfMessage(res.stderr)
          : undefined,
    };
  } catch (err) {
    // After a crash or OOM the WASM instance is unreliable: start fresh next time.
    qpdf.reset();
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
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    removeScratchFiles(runner, files);
  }
}

exposeWorker<UnlockRequest, UnlockResult>(scope, async (req, ctx) => {
  ctx.progress(0.1, "Starting");
  const result = await unlock(req);
  const transfer = result.status === "unlocked" ? [result.data] : [];
  return { result, transfer };
});
