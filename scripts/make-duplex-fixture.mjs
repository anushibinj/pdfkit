// Builds the page organizer's manual-test fixtures: a double-sided paper
// stack scanned on a single-sided feeder. The fronts come out in order and
// the backs in reverse, so the pages read 1 3 5 7 9 10 8 6 4 2.
// - fixtures/duplex-scan.pdf: both passes in one file (10 pages);
// - fixtures/duplex-fronts.pdf and fixtures/duplex-backs.pdf: one file per
//   pass (5 pages each), to interleave across two files.
// "Interleave all" restores pages 1 to 10 in order. Each page shows its
// number as real text, in a different shade, so the order is easy to check.
// The fixtures are committed; this only needs to run to change them.
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const FRONTS = [1, 3, 5, 7, 9];
const BACKS = [10, 8, 6, 4, 2];

/**
 * Make a PDF whose pages show the given numbers.
 *
 * @param {number[]} numbers One page per number, in order.
 * @returns {Promise<Uint8Array>} The file.
 */
async function numberedPdf(numbers) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  // Fixed metadata so regenerating gives the same bytes.
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setProducer("pdfkit fixture");
  for (const n of numbers) {
    const page = doc.addPage([420, 595]); // A5 portrait
    const shade = 0.15 + (n % 5) * 0.12;
    page.drawText(`Page ${n}`, {
      x: 60,
      y: 470,
      size: 56,
      font,
      color: rgb(shade, 0.2, 0.55),
    });
    page.drawText(n % 2 === 1 ? "front of a sheet" : "back of a sheet", {
      x: 60,
      y: 420,
      size: 20,
      font,
    });
  }
  return doc.save({ useObjectStreams: false });
}

const outputs = [
  ["duplex-scan.pdf", [...FRONTS, ...BACKS]],
  ["duplex-fronts.pdf", FRONTS],
  ["duplex-backs.pdf", BACKS],
];
for (const [name, numbers] of outputs) {
  const bytes = await numberedPdf(numbers);
  writeFileSync(new URL(`../fixtures/${name}`, import.meta.url), bytes);
  console.log(`wrote fixtures/${name}`, bytes.length, "bytes");
}
