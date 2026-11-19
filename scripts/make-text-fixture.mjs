// Builds fixtures/text-chromium.pdf: a page printed to PDF by Chromium (the
// same engine as "Save as PDF" in Chrome and Google Docs exports), so the
// in-place text editing tests run on what real files contain: embedded
// subset fonts, lines split into several text objects, a bold word inside a
// line, a coloured line and ligatures.
// Requires Playwright with Chromium, and the DejaVu fonts installed (the
// fixture is committed, so this only needs to run to change it).
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = `<!doctype html><html><body style="margin:0;padding:40px;font-family:'DejaVu Sans'">
  <h1 style="font-family:'DejaVu Serif';font-size:28px;margin:0 0 16px">Quarterly Report</h1>
  <p style="font-size:14px;margin:0 0 10px">Total amount due is 1250 dollars.</p>
  <p style="font-size:14px;margin:0 0 10px">Please pay by <b>Friday</b> at the latest.</p>
  <p style="font-size:12px;color:#c00000;margin:0 0 10px">Contact: billing team</p>
  <p style="font-family:'DejaVu Serif';font-size:16px;margin:0">fluffy office</p>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(html);
  const pdf = await page.pdf({ width: "500px", height: "320px" });
  writeFileSync(new URL("../fixtures/text-chromium.pdf", import.meta.url), pdf);
  console.log("wrote fixtures/text-chromium.pdf", pdf.length, "bytes");
} finally {
  await browser.close();
}
