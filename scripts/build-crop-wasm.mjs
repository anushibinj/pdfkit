// Builds the pdf-crop WebAssembly module (crates/pdf-crop) and collects the
// licences of every crate linked into it.
//
// Outputs, both committed so that building the site never needs Rust:
// - crates/pdf-crop/dist/pdf_crop.wasm
// - crates/pdf-crop/dist/THIRD_PARTY_LICENSES.txt
//
// Requires rustup; the toolchain and wasm32 target are pinned in
// crates/pdf-crop/rust-toolchain.toml and installed by rustup on first use.
// Run with `pnpm wasm:crop`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const crate = path.join(repo, "crates/pdf-crop");
const dist = path.join(crate, "dist");
const target = "wasm32-unknown-unknown";
const cargoHome = process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo");

// Rust embeds source paths in panic messages. Remap the machine-specific
// prefixes (this checkout, the cargo registry) so the binary does not reveal
// where it was built and builds the same on every machine.
// CARGO_ENCODED_RUSTFLAGS replaces (does not extend) the flags in
// .cargo/config.toml, so the getrandom backend flag from there is repeated.
const rustflags = [
  "--cfg",
  'getrandom_backend="custom"',
  `--remap-path-prefix=${path.join(cargoHome, "registry", "src")}${path.sep}=registry/`,
  `--remap-path-prefix=${repo}${path.sep}=pdfkit/`,
];
execFileSync("cargo", ["build", "--release", "--target", target], {
  cwd: crate,
  stdio: "inherit",
  env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: rustflags.join("\x1f") },
});
await mkdir(dist, { recursive: true });
await copyFile(
  path.join(crate, "target", target, "release", "pdf_crop.wasm"),
  path.join(dist, "pdf_crop.wasm"),
);

/**
 * The crates linked into the WebAssembly build: everything reachable from
 * pdf-crop through normal (not dev or build) dependencies, resolved for the
 * wasm32 target.
 *
 * @returns {{ name: string, version: string, license: string, repository: string | null, dir: string }[]}
 */
function linkedCrates() {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--format-version", "1", "--filter-platform", target],
      { cwd: crate, maxBuffer: 64 * 1024 * 1024 },
    ).toString(),
  );
  const packages = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const stack = [metadata.resolve.root];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg);
    }
  }
  return [...seen]
    .map((id) => packages.get(id))
    .filter((p) => p.id !== metadata.resolve.root)
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? "(not declared)",
      repository: p.repository ?? null,
      dir: path.dirname(p.manifest_path),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The licence and notice files a crate ships, read in name order.
 *
 * @param {string} dir The crate's source directory.
 * @returns {{ file: string, text: string }[]}
 */
function licenceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|copyright|notice)/i.test(f))
    .sort()
    .map((file) => ({
      file,
      text: readFileSync(path.join(dir, file), "utf8"),
    }));
}

// Most crates ship the same MIT and Apache-2.0 texts, differing at most in
// white space. Each distinct text is written once, followed by the crates
// that ship it, which keeps the file small enough to serve with the site.
//
// A crate that ships no licence file of its own (alloc-stdlib, for one)
// is covered by the files of a linked crate from the same repository.
const crates = linkedCrates();
const texts = new Map(); // normalised text -> { text, users: string[] }
const list = crates.map(({ name, version, license, repository, dir }) => {
  let files = licenceFiles(dir);
  let note = "";
  if (files.length === 0) {
    const sibling = crates.find(
      (c) =>
        c.repository &&
        c.repository === repository &&
        licenceFiles(c.dir).length > 0,
    );
    files = sibling ? licenceFiles(sibling.dir) : [];
    note = sibling
      ? ` - no licence file of its own; covered by ${sibling.name}'s, same repository (${repository})`
      : " - ships no licence file";
  }
  for (const { file, text } of files) {
    const key = text.replace(/\s+/g, " ").trim();
    const entry = texts.get(key) ?? { text: text.trim(), users: [] };
    entry.users.push(`${name} ${version} (${file})`);
    texts.set(key, entry);
  }
  return `- ${name} ${version}: ${license}${note}`;
});
const rule = "=".repeat(78);
const bodies = [...texts.values()].map(
  ({ text, users }) =>
    `${rule}\nUsed by:\n${users.map((u) => `  ${u}`).join("\n")}\n${rule}\n${text}\n`,
);
await writeFile(
  path.join(dist, "THIRD_PARTY_LICENSES.txt"),
  "Third-party crates linked into pdf_crop.wasm (generated by scripts/build-crop-wasm.mjs).\n\n" +
    `${list.join("\n")}\n\nLicence texts:\n\n${bodies.join("\n")}`,
);
console.log(
  `pdf_crop.wasm and licences for ${crates.length} crates (${texts.size} distinct texts) written to ${path.relative(process.cwd(), dist)}`,
);
