import type { PDFContext, PDFObject, PDFRef } from "pdf-lib";

/** An object to append in the incremental section. */
export interface UpdateObject {
  ref: PDFRef;
  object: PDFObject;
}

export interface TrailerInfo {
  root: PDFRef;
  info?: PDFRef;
  /** Already-serialised `/ID [...]` array, copied verbatim from the original */
  id?: PDFObject;
}

const enc = new TextEncoder();

function toBytes(obj: PDFObject): Uint8Array {
  const buf = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(buf, 0);
  return buf;
}

/** The offset written after the last `startxref` keyword, or null. */
export function findPrevStartXref(pdf: Uint8Array): number | null {
  const tail = new TextDecoder("latin1").decode(
    pdf.subarray(Math.max(0, pdf.length - 2048)),
  );
  const i = tail.lastIndexOf("startxref");
  if (i < 0) return null;
  const m = /^startxref\s+(\d+)/.exec(tail.slice(i));
  return m ? Number(m[1]) : null;
}

/** True when the revision at `offset` is a cross-reference stream. */
function isXrefStream(pdf: Uint8Array, offset: number): boolean {
  const head = new TextDecoder("latin1").decode(
    pdf.subarray(offset, Math.min(offset + 16, pdf.length)),
  );
  return !/^xref/.test(head);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Append `objects` to `pdf` as a new revision (PDF 32000-1 section 7.5.6).
 * The original bytes are copied untouched, so existing signatures keep
 * covering exactly what they covered before.
 *
 * Writes a classic xref table when the previous revision used one, or an
 * uncompressed xref stream when it used an xref stream.
 */
export function appendIncrementalUpdate(
  pdf: Uint8Array,
  context: PDFContext,
  objects: UpdateObject[],
  trailer: TrailerInfo,
): Uint8Array {
  const prev = findPrevStartXref(pdf);
  if (prev === null || prev >= pdf.length) {
    throw new Error("Could not find the PDF's cross-reference table");
  }
  const useStream = isXrefStream(pdf, prev);
  const sorted = [...objects].sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);

  const parts: Uint8Array[] = [pdf];
  let length = pdf.length;
  const push = (bytes: Uint8Array) => {
    parts.push(bytes);
    length += bytes.length;
  };
  const last = pdf[pdf.length - 1];
  if (last !== 0x0a && last !== 0x0d) push(enc.encode("\n"));

  const offsets = new Map<number, number>();
  for (const { ref, object } of sorted) {
    offsets.set(ref.objectNumber, length);
    push(enc.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    push(toBytes(object));
    push(enc.encode("\nendobj\n"));
  }

  const highest = Math.max(
    context.largestObjectNumber,
    ...sorted.map((o) => o.ref.objectNumber),
  );

  // Group consecutive object numbers into xref subsections.
  const groups: { start: number; nums: number[] }[] = [];
  for (const { ref } of sorted) {
    const g = groups[groups.length - 1];
    if (g && ref.objectNumber === g.start + g.nums.length) g.nums.push(ref.objectNumber);
    else groups.push({ start: ref.objectNumber, nums: [ref.objectNumber] });
  }

  const optional = (): string =>
    (trailer.info ? `/Info ${trailer.info.objectNumber} ${trailer.info.generationNumber} R\n` : "") +
    (trailer.id ? `/ID ${trailer.id.toString()}\n` : "");
  const root = `/Root ${trailer.root.objectNumber} ${trailer.root.generationNumber} R\n`;

  if (!useStream) {
    const xrefPos = length;
    let table = "xref\n";
    for (const g of groups) {
      table += `${g.start} ${g.nums.length}\n`;
      for (const n of g.nums) {
        table += `${String(offsets.get(n)).padStart(10, "0")} ${String(0).padStart(5, "0")} n \n`;
      }
    }
    table +=
      `trailer\n<<\n/Size ${highest + 1}\n${root}${optional()}/Prev ${prev}\n>>\n` +
      `startxref\n${xrefPos}\n%%EOF\n`;
    push(enc.encode(table));
  } else {
    // Cross-reference stream: entries are [type=1, offset(4 bytes), gen(2 bytes)].
    const xrefNum = highest + 1;
    const xrefPos = length;
    offsets.set(xrefNum, xrefPos);
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    const xgroups: { start: number; nums: number[] }[] = [];
    for (const n of nums) {
      const g = xgroups[xgroups.length - 1];
      if (g && n === g.start + g.nums.length) g.nums.push(n);
      else xgroups.push({ start: n, nums: [n] });
    }
    const data = new Uint8Array(nums.length * 7);
    nums.forEach((n, i) => {
      const off = offsets.get(n)!;
      const o = i * 7;
      data[o] = 1;
      data[o + 1] = (off >>> 24) & 0xff;
      data[o + 2] = (off >>> 16) & 0xff;
      data[o + 3] = (off >>> 8) & 0xff;
      data[o + 4] = off & 0xff;
      data[o + 5] = 0;
      data[o + 6] = 0;
    });
    const index = xgroups.map((g) => `${g.start} ${g.nums.length}`).join(" ");
    const dict =
      `<<\n/Type /XRef\n/Size ${xrefNum + 1}\n/W [1 4 2]\n/Index [${index}]\n` +
      `${root}${optional()}/Prev ${prev}\n/Length ${data.length}\n>>`;
    push(enc.encode(`${xrefNum} 0 obj\n${dict}\nstream\n`));
    push(data);
    push(enc.encode(`\nendstream\nendobj\nstartxref\n${xrefPos}\n%%EOF\n`));
  }
  return concat(parts);
}
