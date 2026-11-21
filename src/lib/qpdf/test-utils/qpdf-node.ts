/**
 * Test-only helper that runs the real qpdf WebAssembly build in Node, through
 * the same `loadQpdf` the workers use. Node only (reads files with fs).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadQpdf, type QpdfRunner } from "../qpdf-runner";

/**
 * Load qpdf from the npm package.
 *
 * Two quirks of the package's Node build are handled here:
 * - It binds `console.warn` (its stderr) when its glue is evaluated. So the
 *   glue is evaluated inside the importer, after `loadQpdf` installed its
 *   capture on the global console, and dropped from the require cache
 *   first, so a second load in the same process binds again. The original
 *   console methods are restored afterwards; qpdf keeps the bound capture.
 * - It stores each run's exit code in `process.exitCode`, which would make
 *   the test process exit with qpdf's last code (2 after a test of a
 *   failure). Each run restores the previous value.
 *
 * @returns A runner backed by the real binary.
 */
export async function loadNodeQpdf(): Promise<QpdfRunner> {
  const require = createRequire(import.meta.url);
  const gluePath = require.resolve("@jspawn/qpdf-wasm/qpdf.js");
  const wasm = new Uint8Array(
    readFileSync(require.resolve("@jspawn/qpdf-wasm/qpdf.wasm")),
  );
  const { warn, log } = console;
  let runner: QpdfRunner;
  try {
    runner = await loadQpdf({
      wasmDir: "/qpdf/",
      importer: async () => {
        delete require.cache[gluePath];
        return { default: require(gluePath) };
      },
      console,
      fetch: async () =>
        new Response(wasm, { headers: { "content-type": "application/wasm" } }),
      wasm: WebAssembly,
    });
  } finally {
    console.warn = warn;
    console.log = log;
  }
  const run = runner.run.bind(runner);
  runner.run = (args) => {
    const before = process.exitCode;
    try {
      return run(args);
    } finally {
      process.exitCode = before;
    }
  };
  return runner;
}
