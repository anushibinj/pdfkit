// Copies the qpdf WASM build into public/wasm so it is served from our own
// origin (never a CDN). Runs automatically before `dev` and `build`.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("@jspawn/qpdf-wasm/package.json"));
const out = path.resolve(import.meta.dirname, "../public/wasm");
await mkdir(out, { recursive: true });

for (const file of ["qpdf.mjs", "qpdf.js", "browser.js", "qpdf.wasm"]) {
  await copyFile(path.join(pkgDir, file), path.join(out, file));
}
await copyFile(path.join(pkgDir, "LICENSE"), path.join(out, "LICENSE.txt"));
const { version } = JSON.parse(await readFile(path.join(pkgDir, "package.json"), "utf8"));
await writeFile(
  path.join(out, "NOTICE.txt"),
  `qpdf compiled to WebAssembly: @jspawn/qpdf-wasm ${version} (Apache-2.0).\n` +
    "qpdf itself is Copyright Jay Berkenbilt and is licensed under the Apache License 2.0.\n" +
    "https://github.com/qpdf/qpdf  https://github.com/jsscheller/qpdf-wasm\n",
);
console.log(`qpdf-wasm ${version} copied to public/wasm`);
