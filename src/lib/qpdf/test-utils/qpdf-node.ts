/**
 * Test-only helpers that run the real qpdf WebAssembly build in Node, through
 * the same `instantiateQpdf` and `QpdfRunner` code the browser uses.
 * Node only (uses fs and process).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { instantiateQpdf } from "../load-qpdf";
import type { QpdfFactory, QpdfModule } from "../qpdf-module";
import { QpdfOutput } from "../qpdf-output";
import { QpdfRunner } from "../qpdf-runner";

/** A runner on the real binary, plus a way to give the console back. */
export interface NodeQpdf {
  runner: QpdfRunner;
  /** Restore `console.log`/`console.warn` (call in `afterAll`). */
  restoreConsole(): void;
}

/**
 * Keep qpdf from changing the test process's exit status.
 *
 * Under Node, this Emscripten build stores every non-zero qpdf exit code in
 * `process.exitCode` before returning it from `callMain`. A test that
 * deliberately makes qpdf fail (wrong password, damaged file) would then make
 * the whole test run exit with status 2 even though every test passed. The
 * wrapper puts the previous value back after each command. Browsers have no
 * `process`, so production code needs no such wrapper.
 *
 * @param qpdf The module.
 * @returns The same module with a side-effect-free `callMain`.
 */
function withoutExitCodeSideEffect(qpdf: QpdfModule): QpdfModule {
  return {
    FS: qpdf.FS,
    callMain(args) {
      const previous = process.exitCode;
      try {
        return qpdf.callMain(args);
      } finally {
        process.exitCode = previous;
      }
    },
  };
}

/**
 * Instantiate qpdf from the npm package's files.
 *
 * The CommonJS glue (`qpdf.js`) is loaded with `require`, since the ESM
 * wrapper (`qpdf.mjs`) relies on globals that only make sense in a browser.
 * The binary is read from disk; the URL the loader asks for is checked so a
 * wrong file name in `instantiateQpdf` fails here too.
 *
 * @returns The runner and a console restorer.
 */
export async function loadNodeQpdf(): Promise<NodeQpdf> {
  const require = createRequire(import.meta.url);
  const factory = require("@jspawn/qpdf-wasm/qpdf.js") as QpdfFactory;
  const wasm = readFileSync(require.resolve("@jspawn/qpdf-wasm/qpdf.wasm"));
  const output = new QpdfOutput();
  const restoreConsole = output.attachTo(console);
  const qpdf = await instantiateQpdf(
    factory,
    "/wasm/",
    async (url, imports) => {
      if (url !== "/wasm/qpdf.wasm")
        throw new Error(`Unexpected binary URL ${url}`);
      return (await WebAssembly.instantiate(wasm, imports)).instance;
    },
  );
  return {
    runner: new QpdfRunner(withoutExitCodeSideEffect(qpdf), output),
    restoreConsole,
  };
}

/**
 * Read a file from the repository's `fixtures/` directory.
 *
 * @param name File name, e.g. "plain.pdf".
 * @returns Its bytes.
 */
export function readFixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(new URL(`../../../../fixtures/${name}`, import.meta.url)),
  );
}
