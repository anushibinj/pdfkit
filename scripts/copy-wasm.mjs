// Copies the WebAssembly engines into public/wasm so they are served from our
// own origin (never a CDN). Runs automatically before `dev` and `build`.
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const out = path.resolve(import.meta.dirname, "../public/wasm");
await mkdir(out, { recursive: true });

/**
 * One entry per engine: which npm package (or, with `dir`, which directory of
 * this repository), which of its files to serve, and where its licences go. A
 * file is either a name (copied as is) or `{ from, to }` (a path inside the
 * package, served under another name). Licences get distinct names because
 * several engines share the directory.
 */
const engines = [
  {
    pkg: "@jspawn/qpdf-wasm",
    files: ["qpdf.mjs", "qpdf.js", "browser.js", "qpdf.wasm"],
    licenses: [{ from: "LICENSE", to: "LICENSE.txt" }],
    notice: (version) =>
      `qpdf compiled to WebAssembly: @jspawn/qpdf-wasm ${version} (Apache-2.0).\n` +
      "qpdf itself is Copyright Jay Berkenbilt and is licensed under the Apache License 2.0.\n" +
      "https://github.com/qpdf/qpdf  https://github.com/jsscheller/qpdf-wasm\n",
  },
  {
    pkg: "ironpress",
    files: ["ironpress.js", "ironpress_bg.wasm"],
    licenses: [{ from: "LICENSE", to: "LICENSE-ironpress.txt" }],
    notice: (version) =>
      `HTML/CSS to PDF layout: ironpress ${version} (MIT), Copyright (c) 2026 Gaston Gouron.\n` +
      "https://github.com/gastongouron/ironpress\n",
  },
  {
    pkg: "@embedpdf/pdfium",
    // The browser build of the JavaScript glue, renamed so the worker can
    // import /wasm/pdfium.js; it finds pdfium.wasm next to itself.
    files: [
      { from: "dist/index.browser.js", to: "pdfium.js" },
      { from: "dist/pdfium.wasm", to: "pdfium.wasm" },
    ],
    licenses: [
      { from: "LICENSE", to: "LICENSE-embedpdf-pdfium.txt" },
      { from: "LICENSE.pdfium", to: "LICENSE-pdfium.txt" },
    ],
    notice: (version) =>
      `PDF rendering and editing: PDFium, Copyright The PDFium Authors (BSD-3-Clause and Apache-2.0,\n` +
      `see LICENSE-pdfium.txt), compiled to WebAssembly by @embedpdf/pdfium ${version} (MIT),\n` +
      "Copyright (c) 2024 CloudPDF, Ji Chang (see LICENSE-embedpdf-pdfium.txt).\n" +
      "https://pdfium.googlesource.com/pdfium/  https://github.com/embedpdf/embed-pdf-viewer\n",
  },
  {
    // Built from crates/pdf-crop by `pnpm wasm:crop`; the binary is committed.
    pkg: "pdf-crop",
    dir: "crates/pdf-crop",
    files: [{ from: "dist/pdf_crop.wasm", to: "pdf-crop.wasm" }],
    licenses: [
      {
        from: "dist/THIRD_PARTY_LICENSES.txt",
        to: "LICENSE-pdf-crop-third-party.txt",
      },
    ],
    notice: (version) =>
      `PDF cropping: pdf-crop ${version}, part of pdfkit (crates/pdf-crop), built on lopdf (MIT)\n` +
      "and other Rust crates (see LICENSE-pdf-crop-third-party.txt). Standard font metrics:\n" +
      "Adobe Core 14 AFM via @pdf-lib/standard-fonts (MIT); encodings from ISO 32000-1 Annex D\n" +
      "as transcribed by pdf.js (Apache-2.0). https://github.com/J-F-Liu/lopdf\n",
  },
];

/**
 * Find a package's root directory.
 *
 * `require.resolve("<pkg>/package.json")` is the simple way, but packages
 * with an `exports` map that does not list package.json refuse it
 * (ERR_PACKAGE_PATH_NOT_EXPORTED). Then resolve the package's main entry
 * and walk up to the directory whose package.json has the package's name.
 *
 * @param {string} pkg Package name.
 * @returns {string} Absolute path of the package root.
 */
function packageDir(pkg) {
  try {
    return path.dirname(require.resolve(`${pkg}/package.json`));
  } catch {
    let dir = path.dirname(require.resolve(pkg));
    for (;;) {
      const manifest = path.join(dir, "package.json");
      if (
        existsSync(manifest) &&
        JSON.parse(readFileSync(manifest, "utf8")).name === pkg
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir)
        throw new Error(`Cannot find the package directory of ${pkg}`);
      dir = parent;
    }
  }
}

/**
 * The version of an engine: from its package.json, or for an in-repository
 * Rust crate from the `version` line of its Cargo.toml.
 *
 * @param {string} dir The engine's directory.
 * @returns {Promise<string>} The version.
 */
async function engineVersion(dir) {
  const manifest = path.join(dir, "package.json");
  if (existsSync(manifest)) {
    return JSON.parse(await readFile(manifest, "utf8")).version;
  }
  const cargo = await readFile(path.join(dir, "Cargo.toml"), "utf8");
  const match = /^version\s*=\s*"([^"]+)"/m.exec(cargo);
  if (!match) throw new Error(`No version in ${dir}/Cargo.toml`);
  return match[1];
}

const notices = [];
for (const { pkg, dir, files, licenses, notice } of engines) {
  const pkgDir = dir
    ? path.resolve(import.meta.dirname, "..", dir)
    : packageDir(pkg);
  for (const file of files) {
    const { from, to } =
      typeof file === "string" ? { from: file, to: file } : file;
    await copyFile(path.join(pkgDir, from), path.join(out, to));
  }
  for (const { from, to } of licenses) {
    await copyFile(path.join(pkgDir, from), path.join(out, to));
  }
  const version = await engineVersion(pkgDir);
  notices.push(notice(version));
  console.log(`${pkg} ${version} copied to public/wasm`);
}
await writeFile(path.join(out, "NOTICE.txt"), notices.join("\n"));
