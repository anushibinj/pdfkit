import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  StandardFonts,
  rgb,
} from "pdf-lib";

export interface StampOptions {
  signatureCount: number;
  /** ISO date shown in the caption */
  verifiedAt: string;
}

/** Rect of the first signature widget as [x, y, w, h] on its page, if any. */
function findSignatureRect(doc: PDFDocument) {
  const pages = doc.getPages();
  for (let p = 0; p < pages.length; p++) {
    const annots = pages[p].node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a) continue;
      const ft =
        a.lookupMaybe(PDFName.of("FT"), PDFName) ??
        a.lookupMaybe(PDFName.of("Parent"), PDFDict)?.lookupMaybe(
          PDFName.of("FT"),
          PDFName,
        );
      if (ft?.toString() !== "/Sig") continue;
      const rect = a.lookupMaybe(PDFName.of("Rect"), PDFArray);
      if (!rect || rect.size() < 4) continue;
      const n = [0, 1, 2, 3].map(
        (k) => rect.lookupMaybe(k, PDFNumber)?.asNumber() ?? 0,
      );
      const x = Math.min(n[0], n[2]);
      const y = Math.min(n[1], n[3]);
      const w = Math.abs(n[2] - n[0]);
      const h = Math.abs(n[3] - n[1]);
      if (w > 1 && h > 1) return { page: p, x, y, w, h };
    }
  }
  return null;
}

/**
 * Draw a green tick and a short honest caption on the page that holds the
 * signature (or the top-right of page 1 for invisible signatures).
 *
 * Note: re-saving rewrites the file, so the ORIGINAL signature will no longer
 * validate in other readers. The caption says the check happened locally and
 * that the signer's identity was not checked against a trust list.
 */
export async function stampVerified(
  data: ArrayBuffer,
  opts: StampOptions,
): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const pages = doc.getPages();
  if (pages.length === 0) throw new Error("PDF has no pages");
  const target = findSignatureRect(doc);
  const page = pages[target?.page ?? 0];
  const { width, height } = page.getSize();

  const size = target ? Math.min(Math.max(Math.min(target.w, target.h), 18), 36) : 28;
  const x = target ? target.x + target.w + 6 : width - size - 24;
  const y = target ? target.y + (target.h - size) / 2 : height - size - 24;
  const cx = Math.min(x, width - size - 4);
  const green = rgb(0.09, 0.64, 0.29);

  page.drawCircle({
    x: cx + size / 2,
    y: y + size / 2,
    size: size / 2,
    color: green,
  });
  // Tick as two white strokes, scaled to the circle.
  const s = size;
  page.drawLine({
    start: { x: cx + s * 0.25, y: y + s * 0.5 },
    end: { x: cx + s * 0.43, y: y + s * 0.3 },
    thickness: s * 0.11,
    color: rgb(1, 1, 1),
  });
  page.drawLine({
    start: { x: cx + s * 0.43, y: y + s * 0.3 },
    end: { x: cx + s * 0.76, y: y + s * 0.68 },
    thickness: s * 0.11,
    color: rgb(1, 1, 1),
  });

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const label =
    opts.signatureCount === 1
      ? "Signature valid"
      : `${opts.signatureCount} signatures valid`;
  const note = `Checked in-browser ${opts.verifiedAt.slice(0, 10)}; signer not checked against a trust list`;
  const textX = Math.max(cx - 4, 4);
  const noteSize = 5.5;
  const textW = Math.max(
    font.widthOfTextAtSize(note, noteSize),
    font.widthOfTextAtSize(label, 8),
  );
  const tx = Math.min(textX, Math.max(width - textW - 4, 4));
  page.drawText(label, { x: tx, y: y - 10, size: 8, font, color: green });
  page.drawText(note, {
    x: tx,
    y: y - 18,
    size: noteSize,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  const out = await doc.save();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}
