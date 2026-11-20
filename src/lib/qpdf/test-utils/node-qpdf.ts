/**
 * Test-only helper that runs the real qpdf WebAssembly build in Node.
 * Import it from tests marked `// @vitest-environment node`.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadQpdf } from "../load-qpdf";
import type { QpdfRunner } from "../qpdf-runner";

/**
 * Load qpdf from the npm package through the same {@link loadQpdf} the
 * workers use. Only the two environment hooks differ: the glue is imported
 * by file URL, and the binary is read from disk (Node's `fetch` cannot read
 * files).
 *
 * @returns A runner for a fresh qpdf instance.
 */
export async function loadNodeQpdf(): Promise<QpdfRunner> {
  const require = createRequire(import.meta.url);
  const dir = path.dirname(require.resolve("@jspawn/qpdf-wasm/package.json"));
  const binary = readFileSync(path.join(dir, "qpdf.wasm"));
  return loadQpdf(`${pathToFileURL(dir).href}/`, {
    importer: (url) => import(/* @vite-ignore */ url),
    instantiate: async (imports) =>
      (await WebAssembly.instantiate(binary, imports)).instance,
    console,
  });
}
