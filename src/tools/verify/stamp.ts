import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import { appendIncrementalUpdate, type UpdateObject } from "./incremental";

export interface StampOptions {
  signatureCount: number;
  /** ISO date shown in the caption */
  verifiedAt: string;
}

/** Rect of the first signature widget as page index + [x, y, w, h]. */
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
      const w = Math.abs(n[2] - n[0]);
      const h = Math.abs(n[3] - n[1]);
      if (w > 1 && h > 1) {
        return { page: p, x: Math.min(n[0], n[2]), y: Math.min(n[1], n[3]), w, h };
      }
    }
  }
  return null;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Add a green tick and a short honest caption as a Stamp annotation, written
 * as an INCREMENTAL UPDATE: the original bytes are kept exactly, so existing
 * digital signatures still validate (readers will note that an annotation was
 * added after signing). The caption says the check happened locally and that
 * the signer was not checked against a trust list.
 *
 * Throws for encrypted files, where appended objects would need encrypting.
 */
export async function stampVerified(
  data: ArrayBuffer,
  opts: StampOptions,
): Promise<ArrayBuffer> {
  const original = new Uint8Array(data);
  const doc = await PDFDocument.load(original, {
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  const ctx = doc.context;
  const trailer = ctx.trailerInfo;
  if (trailer.Encrypt) {
    throw new Error(
      "This PDF is encrypted, so a tick cannot be added without breaking its signature.",
    );
  }
  if (!(trailer.Root instanceof PDFRef)) {
    throw new Error("Could not find the document catalog");
  }
  const pages = doc.getPages();
  if (pages.length === 0) throw new Error("PDF has no pages");

  const target = findSignatureRect(doc);
  const page = pages[target?.page ?? 0];
  const { width: pw, height: ph } = page.getSize();

  // Layout (page coordinates).
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const label =
    opts.signatureCount === 1
      ? "Signature valid"
      : `${opts.signatureCount} signatures valid`;
  const note = `Checked in-browser ${opts.verifiedAt.slice(0, 10)}; signer not checked against a trust list`;
  const noteSize = 5.5;
  const labelSize = 8;
  const size = target
    ? Math.min(Math.max(Math.min(target.w, target.h), 18), 36)
    : 28;
  const textW = Math.max(
    font.widthOfTextAtSize(note, noteSize),
    font.widthOfTextAtSize(label, labelSize),
  );
  const boxW = Math.min(Math.max(size, textW) + 4, pw - 8);
  const boxH = size + 22;
  let bx = target ? target.x + target.w + 6 : pw - boxW - 24;
  let by = target ? target.y + (target.h - size) / 2 - 20 : ph - boxH - 24;
  bx = Math.max(4, Math.min(bx, pw - boxW - 4));
  by = Math.max(4, Math.min(by, ph - boxH - 4));

  // Appearance stream in its own coordinate space: origin = bottom-left of box.
  const cx = 2 + size / 2;
  const cy = 20 + size / 2;
  const s = size;
  const content = [
    "q",
    "0.09 0.64 0.29 rg",
    // circle via four Bezier arcs
    ...(() => {
      const r = size / 2;
      const k = 0.5523 * r;
      return [
        `${f(cx + r)} ${f(cy)} m`,
        `${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c`,
        `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c`,
        `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c`,
        `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c`,
        "f",
      ];
    })(),
    "1 1 1 RG",
    `${f(s * 0.11)} w 1 J 1 j`,
    `${f(2 + s * 0.25)} ${f(20 + s * 0.5)} m`,
    `${f(2 + s * 0.43)} ${f(20 + s * 0.3)} l`,
    `${f(2 + s * 0.76)} ${f(20 + s * 0.68)} l S`,
    "BT",
    "/F1 8 Tf 0.09 0.64 0.29 rg",
    `2 10 Td (${label}) Tj`,
    "ET",
    "BT",
    `/F1 ${noteSize} Tf 0.35 0.35 0.35 rg`,
    `2 2 Td (${note.replace(/[()\\]/g, "\\$&")}) Tj`,
    "ET",
    "Q",
  ].join("\n");

  const bytes = new TextEncoder().encode(content);
  const apStream = ctx.stream(bytes, {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, boxW, boxH],
    Resources: {
      Font: {
        F1: {
          Type: "Font",
          Subtype: "Type1",
          BaseFont: "Helvetica",
          Encoding: "WinAnsiEncoding",
        },
      },
    },
  });
  const apRef = ctx.nextRef();

  const annotRef = ctx.nextRef();
  const annot = ctx.obj({
    Type: "Annot",
    Subtype: "Stamp",
    Rect: [bx, by, bx + boxW, by + boxH],
    F: 4 | 64, // Print + ReadOnly
    Contents: PDFString.of("Signature checked in-browser"),
    P: page.ref,
    AP: { N: apRef },
  });

  const updates: UpdateObject[] = [
    { ref: apRef, object: apStream },
    { ref: annotRef, object: annot },
  ];

  // Attach the annotation: rewrite whichever object holds the page's /Annots.
  const annotsKey = PDFName.of("Annots");
  const raw = page.node.get(annotsKey);
  if (raw instanceof PDFRef) {
    const arr = ctx.lookup(raw, PDFArray);
    const next = ctx.obj([...arr.asArray(), annotRef]);
    updates.push({ ref: raw, object: next });
  } else {
    const existing = raw instanceof PDFArray ? raw.asArray() : [];
    page.node.set(annotsKey, ctx.obj([...existing, annotRef]));
    updates.push({ ref: page.ref, object: page.node });
  }

  const info = trailer.Info instanceof PDFRef ? trailer.Info : undefined;
  const out = appendIncrementalUpdate(original, ctx, updates, {
    root: trailer.Root,
    info,
    id: trailer.ID,
  });
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}
