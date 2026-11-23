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
  {
    // Built from crates/pdf-repair by `pnpm wasm:repair`; the binary is committed.
    pkg: "pdf-repair",
    dir: "crates/pdf-repair",
    files: [{ from: "dist/pdf_repair.wasm", to: "pdf-repair.wasm" }],
    licenses: [
      {
        from: "dist/THIRD_PARTY_LICENSES.txt",
        to: "LICENSE-pdf-repair-third-party.txt",
      },
    ],
    notice: (version) =>
      `PDF repair: pdf-repair ${version}, part of pdfkit (crates/pdf-repair), built on lopdf (MIT)\n` +
      "and other Rust crates (see LICENSE-pdf-repair-third-party.txt). https://github.com/J-F-Liu/lopdf\n",
  },
  {
    // Built from crates/pdf-compress by `pnpm wasm:compress`; the binary is committed.
    pkg: "pdf-compress",
    dir: "crates/pdf-compress",
    files: [{ from: "dist/pdf_compress.wasm", to: "pdf-compress.wasm" }],
    licenses: [
      {
        from: "dist/THIRD_PARTY_LICENSES.txt",
        to: "LICENSE-pdf-compress-third-party.txt",
      },
    ],
    notice: (version) =>
      `PDF compression: pdf-compress ${version}, part of pdfkit (crates/pdf-compress), built on lopdf (MIT)\n` +
      "and other Rust crates (see LICENSE-pdf-compress-third-party.txt). https://github.com/J-F-Liu/lopdf\n",
  },
  {
    // Built from crates/pdf-ocr by `pnpm wasm:ocr`; the binary is committed.
    pkg: "pdf-ocr",
    dir: "crates/pdf-ocr",
    files: [{ from: "dist/pdf_ocr.wasm", to: "pdf-ocr.wasm" }],
    licenses: [
      {
        from: "dist/THIRD_PARTY_LICENSES.txt",
        to: "LICENSE-pdf-ocr-third-party.txt",
      },
    ],
    notice: (version) =>
      `PDF OCR helpers: pdf-ocr ${version}, part of pdfkit (crates/pdf-ocr), built on lopdf (MIT)\n` +
      "and other Rust crates (see LICENSE-pdf-ocr-third-party.txt). https://github.com/J-F-Liu/lopdf\n",
  },
  {
    pkg: "tesseract.js-core",
    files: [
      "tesseract-core-simd-lstm.wasm",
      "tesseract-core-lstm.wasm",
      "tesseract-core-simd-lstm.js",
      "tesseract-core-lstm.js",
    ],
    licenses: [{ from: "LICENSE", to: "LICENSE-tesseract-core.txt" }],
    notice: (version) =>
      `OCR engine: Tesseract OCR compiled to WebAssembly by tesseract.js-core ${version} (Apache-2.0).\n` +
      "https://github.com/tesseract-ocr/tesseract  https://github.com/naptha/tesseract.js-core\n",
  },
  {
    pkg: "tesseract.js",
    files: [{ from: "dist/worker.min.js", to: "tesseract-worker.min.js" }],
    licenses: [{ from: "LICENSE.md", to: "LICENSE-tesseract.txt" }],
    notice: (version) =>
      `Tesseract JavaScript bindings: tesseract.js ${version} (Apache-2.0).\n` +
      "https://github.com/naptha/tesseract.js\n",
  },
  ...[
    "eng",
    "hin",
    "ben",
    "tam",
    "tel",
    "kan",
    "mal",
    "mar",
    "guj",
    "pan",
    "ori",
  ].map((lang) => ({
    pkg: `@tesseract.js-data/${lang}`,
    files: [
      {
        from: `4.0.0_best_int/${lang}.traineddata.gz`,
        to: `${lang}.traineddata.gz`,
      },
    ],
    licenses: [],
    notice: (version) =>
      `OCR language model (${lang}): @tesseract.js-data/${lang} ${version} (Apache-2.0 / MIT).\n` +
      "https://github.com/tesseract-ocr/tessdata_fast\n",
  })),
  {
    // Built from crates/pdf-redact by `pnpm wasm:redact`; the binary is committed.
    pkg: "pdf-redact",
    dir: "crates/pdf-redact",
    files: [{ from: "dist/pdf_redact.wasm", to: "pdf-redact.wasm" }],
    licenses: [
      {
        from: "dist/THIRD_PARTY_LICENSES.txt",
        to: "LICENSE-pdf-redact-third-party.txt",
      },
    ],
    notice: (version) =>
      `PDF redaction: pdf-redact ${version}, part of pdfkit (crates/pdf-redact), built on lopdf (MIT)\n` +
      "and other Rust crates (see LICENSE-pdf-redact-third-party.txt). https://github.com/J-F-Liu/lopdf\n",
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
// Generate ES-module wrappers for tesseract-core-*-lstm.js so module Web Workers
// can `import()` them directly from `/wasm/` under strict CSP (`script-src 'self'`).
for (const base of ["tesseract-core-simd-lstm", "tesseract-core-lstm"]) {
  const jsSource = await readFile(path.join(out, `${base}.js`), "utf8");
  await writeFile(
    path.join(out, `${base}.mjs`),
    `${jsSource}\nexport default TesseractCore;\n`,
  );
}
await writeFile(path.join(out, "NOTICE.txt"), notices.join("\n"));
