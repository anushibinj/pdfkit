// Generates PWA icons from assets/icon.svg. Run: pnpm icons
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "public/icons");
const svg = await readFile(path.join(root, "assets/icon.svg"), "utf8");
await mkdir(out, { recursive: true });

const png = (name, size, source = svg) =>
  sharp(Buffer.from(source), { density: 384 })
    .resize(size, size)
    .png()
    .toFile(path.join(out, name));

// Full-bleed variant (no rounded corners) with the glyph inside the maskable
// safe zone (central 80%).
const bleed = svg
  .replace(/rx="112"/, 'rx="0"')
  .replace(
    /<g transform="[^"]*"/,
    '<g transform="translate(112 112) scale(11.667)"',
  );

await Promise.all([
  png("icon-192.png", 192),
  png("icon-512.png", 512),
  png("icon-maskable-512.png", 512, bleed),
  png("apple-touch-icon.png", 180, bleed),
]);
console.log("icons written to public/icons");
