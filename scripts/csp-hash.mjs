// Computes SHA-256 hashes of every inline <script> and <style> in out/**/*.html
// and writes them into the Content-Security-Policy header in firebase.json.
// This lets us keep script-src/style-src strict (no 'unsafe-inline').
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "out");
const configPath = path.join(root, "firebase.json");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])),
  );
  return nested.flat();
}

const sha = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

const scriptHashes = new Set();
const styleHashes = new Set();
const inlineStyleAttrs = [];

for (const file of (await walk(out)).filter((f) => f.endsWith(".html"))) {
  const html = await readFile(file, "utf8");
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs)) continue; // external, allowed by 'self'
    // Data blocks (JSON-LD) are not executed and not subject to script-src.
    if (/type\s*=\s*["']application\/(ld\+)?json["']/i.test(attrs)) continue;
    if (m[2].trim() === "") continue;
    scriptHashes.add(sha(m[2]));
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (m[1].trim() !== "") styleHashes.add(sha(m[1]));
  }
  if (/<[a-z][^>]*\sstyle=/i.test(html)) inlineStyleAttrs.push(path.relative(out, file));
}

// Libraries such as sonner inject a <style> element at runtime from a string
// literal baked into their JS (and append the element while still empty).
// Find those literals in the built JS and allow their hashes too.
const INJECTED_STYLE = /createElement\("style"\)[\s\S]{0,300}?\}\(("(?:[^"\\]|\\.)*")\)/g;
let injected = 0;
for (const file of (await walk(path.join(out, "_next/static"))).filter((f) => f.endsWith(".js"))) {
  const js = await readFile(file, "utf8");
  for (const m of js.matchAll(INJECTED_STYLE)) {
    try {
      styleHashes.add(sha(JSON.parse(m[1])));
      injected++;
    } catch {
      console.warn(`warning: could not parse an injected style literal in ${path.relative(out, file)}`);
    }
  }
}
if (injected > 0) styleHashes.add(sha("")); // the element is appended before its text is set

if (inlineStyleAttrs.length > 0) {
  console.warn(
    `warning: inline style="" attributes found in ${inlineStyleAttrs.length} file(s); ` +
      "style-src 'self' will block them. Use classes instead.",
  );
}

const config = JSON.parse(await readFile(configPath, "utf8"));
let updated = false;
for (const rule of config.hosting.headers ?? []) {
  for (const header of rule.headers) {
    if (header.key !== "Content-Security-Policy") continue;
    const directives = header.value.split(";").map((d) => d.trim()).filter(Boolean);
    const set = (name, base, hashes) => {
      const value = [name, ...base, ...[...hashes].sort()].join(" ");
      const i = directives.findIndex((d) => d.split(/\s+/)[0] === name);
      if (i >= 0) directives[i] = value;
      else directives.push(value);
    };
    set("script-src", ["'self'", "'wasm-unsafe-eval'"], scriptHashes);
    set("style-src", ["'self'"], styleHashes);
    header.value = directives.join("; ");
    updated = true;
  }
}
if (!updated) throw new Error("No Content-Security-Policy header found in firebase.json");
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
console.log(`CSP updated: ${scriptHashes.size} script hashes, ${styleHashes.size} style hashes`);
