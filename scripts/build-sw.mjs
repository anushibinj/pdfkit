// Generates out/sw.js: the service worker template plus a precache manifest of
// every file in out/ (pages, _next/static, wasm, icons, OG images).
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const out = path.resolve(import.meta.dirname, "../out");
const SKIP = new Set(["sw.js", "404.html", "404/index.html"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    ),
  );
  return files.flat();
}

const files = (await walk(out))
  .map((f) => path.relative(out, f).split(path.sep).join("/"))
  .filter((f) => !SKIP.has(f) && !f.endsWith(".map"))
  .sort();

const urls = [];
const hash = createHash("sha256");
for (const f of files) {
  hash.update(f);
  hash.update(await readFile(path.join(out, f)));
  if (f === "index.html") urls.push("/");
  else if (f.endsWith("/index.html")) urls.push(`/${f.slice(0, -"index.html".length)}`);
  else urls.push(`/${f}`);
}
// Directory index pages are served at both "/x/" and the file path itself.
const manifest = [...new Set(urls)].map((u) => encodeURI(u).replace(/#/g, "%23"));
const version = hash.digest("hex").slice(0, 12);

const template = await readFile(path.resolve(import.meta.dirname, "sw-template.js"), "utf8");
const sw =
  `self.__PRECACHE_VERSION__ = ${JSON.stringify(version)};\n` +
  `self.__PRECACHE_MANIFEST__ = ${JSON.stringify(manifest, null, 1)};\n` +
  template;
await writeFile(path.join(out, "sw.js"), sw);
console.log(`sw.js: ${manifest.length} precached URLs, version ${version}`);
