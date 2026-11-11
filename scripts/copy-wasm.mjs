// Copies the WebAssembly engines into public/wasm so they are served from our
// own origin (never a CDN). Runs automatically before `dev` and `build`.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const out = path.resolve(import.meta.dirname, "../public/wasm");
await mkdir(out, { recursive: true });

/**
 * One entry per engine: which npm package, which of its files to serve, and
 * where its licence goes. Licences get distinct names because several engines
 * share the directory.
 */
const engines = [
  {
    pkg: "@jspawn/qpdf-wasm",
    files: ["qpdf.mjs", "qpdf.js", "browser.js", "qpdf.wasm"],
    license: "LICENSE.txt",
    notice: (version) =>
      `qpdf compiled to WebAssembly: @jspawn/qpdf-wasm ${version} (Apache-2.0).\n` +
      "qpdf itself is Copyright Jay Berkenbilt and is licensed under the Apache License 2.0.\n" +
      "https://github.com/qpdf/qpdf  https://github.com/jsscheller/qpdf-wasm\n",
  },
  {
    pkg: "ironpress",
    files: ["ironpress.js", "ironpress_bg.wasm"],
    license: "LICENSE-ironpress.txt",
    notice: (version) =>
      `HTML/CSS to PDF layout: ironpress ${version} (MIT), Copyright (c) 2026 Gaston Gouron.\n` +
      "https://github.com/gastongouron/ironpress\n",
  },
];

const notices = [];
for (const { pkg, files, license, notice } of engines) {
  const pkgDir = path.dirname(require.resolve(`${pkg}/package.json`));
  for (const file of files) {
    await copyFile(path.join(pkgDir, file), path.join(out, file));
  }
  await copyFile(path.join(pkgDir, "LICENSE"), path.join(out, license));
  const { version } = JSON.parse(
    await readFile(path.join(pkgDir, "package.json"), "utf8"),
  );
  notices.push(notice(version));
  console.log(`${pkg} ${version} copied to public/wasm`);
}
await writeFile(path.join(out, "NOTICE.txt"), notices.join("\n"));
