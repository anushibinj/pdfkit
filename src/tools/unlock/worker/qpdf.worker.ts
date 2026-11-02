/// <reference lib="webworker" />
import { exposeWorker } from "@/lib/worker-protocol";
import type { UnlockRequest, UnlockResult } from "../messages";
import {
  EXIT_ERROR,
  EXIT_OK,
  EXIT_WARNINGS,
  friendlyQpdfMessage,
  isInvalidPassword,
  isOutOfMemory,
} from "./qpdf-run";

interface QpdfFS {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  stat(path: string): unknown;
}
interface QpdfModule {
  FS: QpdfFS;
  callMain(args: string[]): number;
}
interface QpdfOptions {
  noInitialRun: boolean;
  print: (line: string) => void;
  printErr: (line: string) => void;
  locateFile: (file: string) => string;
  instantiateWasm: (
    imports: WebAssembly.Imports,
    done: (instance: WebAssembly.Instance) => void,
  ) => Record<string, never>;
}
type QpdfFactory = (options: QpdfOptions) => Promise<QpdfModule>;

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

let stderrBuffer: string[] = [];
let modulePromise: Promise<QpdfModule> | null = null;

/** Load qpdf once. Everything comes from our own origin (/wasm/). */
function loadQpdf(): Promise<QpdfModule> {
  if (modulePromise) return modulePromise;
  const promise = (async () => {
    // This qpdf build ignores the print/printErr options and binds
    // console.log/console.warn when it is evaluated. Install capturing
    // versions first so qpdf's stderr can be read (this is a worker, so the
    // page's console is unaffected).
    console.warn = (...args: unknown[]) => {
      stderrBuffer.push(args.map(String).join(" "));
    };
    console.log = () => {};
    // The glue code is a static file in public/, not part of the bundle.
    const glue = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ `${WASM_DIR}qpdf.mjs`
    )) as { default: QpdfFactory };
    let failLoad: (reason: unknown) => void = () => {};
    const loadFailed = new Promise<never>((_, reject) => {
      failLoad = reject;
    });
    const ready = glue.default({
      noInitialRun: true,
      print: () => {},
      printErr: (line) => stderrBuffer.push(line),
      locateFile: (file) => `${WASM_DIR}${file}`,
      instantiateWasm(imports, done) {
        const url = `${WASM_DIR}qpdf.wasm`;
        WebAssembly.instantiateStreaming(fetch(url), imports)
          .catch(async () => {
            // Fallback for hosts that do not serve application/wasm.
            const bytes = await (await fetch(url)).arrayBuffer();
            return WebAssembly.instantiate(bytes, imports);
          })
          .then(({ instance }) => done(instance))
          .catch(failLoad);
        return {};
      },
    });
    return Promise.race([ready, loadFailed]);
  })();
  modulePromise = promise;
  // A failed load must be retryable.
  promise.catch(() => {
    if (modulePromise === promise) modulePromise = null;
  });
  return promise;
}

let jobCounter = 0;

function run(qpdf: QpdfModule, args: string[]): { code: number; stderr: string } {
  stderrBuffer = [];
  const code = qpdf.callMain(args);
  return { code, stderr: stderrBuffer.join("\n") };
}

function fileExists(fs: QpdfFS, path: string): boolean {
  try {
    fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

function tryUnlink(fs: QpdfFS, path: string): void {
  try {
    if (fileExists(fs, path)) fs.unlink(path);
  } catch {
    /* best effort cleanup */
  }
}

async function unlock({ data, password }: UnlockRequest): Promise<UnlockResult> {
  let qpdf: QpdfModule;
  try {
    qpdf = await loadQpdf();
  } catch (err) {
    return {
      status: "error",
      reason: "failed",
      message: `Could not load the PDF engine: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const job = `/job-${++jobCounter}-${Math.random().toString(36).slice(2, 8)}`;
  const input = `${job}-in.pdf`;
  const output = `${job}-out.pdf`;
  try {
    qpdf.FS.writeFile(input, new Uint8Array(data));

    let via: "owner" | "password" = "password";
    if (password === undefined) {
      // Detect the encryption state first.
      const probe = run(qpdf, ["--requires-password", input]);
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
    const res = run(qpdf, [...args, input, output]);

    if (res.code === EXIT_ERROR || !fileExists(qpdf.FS, output)) {
      if (isInvalidPassword(res.stderr)) return { status: "wrong-password" };
      return {
        status: "error",
        reason: "failed",
        message: friendlyQpdfMessage(res.stderr),
      };
    }

    const bytes = qpdf.FS.readFile(output);
    // Transfer needs an ArrayBuffer of exactly the file's size.
    const out =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : (bytes.slice().buffer as ArrayBuffer);
    return {
      status: "unlocked",
      via,
      data: out,
      warnings:
        res.code === EXIT_WARNINGS ? friendlyQpdfMessage(res.stderr) : undefined,
    };
  } catch (err) {
    // After a crash or OOM the WASM instance is unreliable: start fresh next time.
    modulePromise = null;
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
    tryUnlink(qpdf.FS, input);
    tryUnlink(qpdf.FS, output);
  }
}

exposeWorker<UnlockRequest, UnlockResult>(scope, async (req, ctx) => {
  ctx.progress(0.1, "Starting");
  const result = await unlock(req);
  const transfer = result.status === "unlocked" ? [result.data] : [];
  return { result, transfer };
});
