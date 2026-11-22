// Builds fixtures/images-chromium.pdf: a page printed to PDF by Chromium
// (the engine behind Chrome's "Save as PDF" and Google Docs exports), so the
// image extraction tests run on what real files contain: images tagged with
// an ICC profile, a transparent PNG stored with a soft mask, a JPEG stored
// as is, the same JPEG drawn twice and a JPEG cropped by CSS (a clip path).
// Requires Playwright with Chromium, and sharp (the fixture is committed, so
// this only needs to run to change it).
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const sharp = require("sharp");

// 24 x 16 PNG: opaque red left half, half-transparent blue right half.
const pixels = Buffer.alloc(24 * 16 * 4);
for (let i = 0; i < 24 * 16; i++) {
  const left = i % 24 < 12;
  pixels.set(left ? [255, 0, 0, 255] : [0, 0, 255, 128], i * 4);
}
const png = await sharp(pixels, { raw: { width: 24, height: 16, channels: 4 } })
  .png()
  .toBuffer();
const solidJpeg = (r, g, b) =>
  sharp({
    create: { width: 32, height: 24, channels: 3, background: { r, g, b } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
const green = await solidJpeg(0, 160, 0);
const purple = await solidJpeg(120, 0, 160);
const url = (bytes, type) => `data:${type};base64,${bytes.toString("base64")}`;

const html = `<!doctype html><html><body style="margin:20px">
  <img src="${url(png, "image/png")}" style="width:96px">
  <img src="${url(green, "image/jpeg")}" style="width:64px">
  <img src="${url(green, "image/jpeg")}" style="width:32px">
  <div style="width:20px;height:20px;overflow:hidden;display:inline-block">
    <img src="${url(purple, "image/jpeg")}" style="width:64px">
  </div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(html);
  const pdf = await page.pdf({ width: "400px", height: "200px" });
  const dir = new URL("../fixtures/", import.meta.url);
  writeFileSync(new URL("images-chromium.pdf", dir), pdf);
  // The source images, to compare extracted files against.
  writeFileSync(new URL("images-chromium-green.jpg", dir), green);
  writeFileSync(new URL("images-chromium-purple.jpg", dir), purple);
  console.log("wrote fixtures/images-chromium.pdf", pdf.length, "bytes");
} finally {
  await browser.close();
}
