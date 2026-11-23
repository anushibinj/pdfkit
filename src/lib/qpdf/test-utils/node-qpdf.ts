/**
 * Test-only: load the real qpdf WebAssembly build in Node through the same
 * `loadQpdf` the workers use. Node only (uses fs and url).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadQpdf } from "../load-qpdf";
import { StderrLog, type QpdfRunner } from "../qpdf-runner";

/**
 * Instantiate qpdf from `node_modules/@jspawn/qpdf-wasm`.
 *
 * Node's `fetch` cannot read `file:` URLs, so the binary is read from disk
 * instead of being streamed. `loadQpdf` replaces the global `console.warn`
 * and `console.log` (the glue binds them while its factory runs); they are
 * restored afterwards so other tests in the same process keep their console.
 * qpdf keeps using the bound copies, so its stderr is still captured.
 *
 * stdout is captured too (results carry `stdout`), so tests can read output
 * such as the page count printed by `--show-npages`.
 *
 * @returns A runner over a fresh qpdf instance.
 */
export async function loadNodeQpdf(): Promise<QpdfRunner> {
  const require = createRequire(import.meta.url);
  const dir = path.dirname(require.resolve("@jspawn/qpdf-wasm/package.json"));
  const { warn, log } = console;
  try {
    return await loadQpdf({
      wasmDir: `${pathToFileURL(dir).href}/`,
      importModule: (url) => import(/* @vite-ignore */ url),
      instantiate: async (url, imports) =>
        (
          await WebAssembly.instantiate(
            readFileSync(fileURLToPath(url)),
            imports,
          )
        ).instance,
      console,
      stderr: new StderrLog(),
      stdout: new StderrLog(),
    });
  } finally {
    console.warn = warn;
    console.log = log;
  }
}

/**
 * Read one of the repository's sample PDFs.
 *
 * @param name File name inside `fixtures/`, e.g. "plain.pdf".
 * @returns Its bytes.
 */
export function readFixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      path.resolve(import.meta.dirname, "../../../../fixtures", name),
    ),
  );
}
