// Builds fixtures/signed.pdf: a one-page PDF (with a classic xref table) and a
// detached CMS signature from a throwaway self-signed key. Requires `openssl`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sigfix-"));
const HEX = 4096; // hex chars reserved inside <...>
const pad = (n) => String(n).padStart(10, "0");

const objs = (ranges) => [
  `1 0 obj\n<</Type/Catalog/Pages 2 0 R/AcroForm<</Fields[5 0 R]/SigFlags 3>>>>\nendobj\n`,
  `2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n`,
  `3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Annots[5 0 R]>>\nendobj\n`,
  `4 0 obj\n<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/adbe.pkcs7.detached/ByteRange [${ranges}]/Contents <`,
  // hex goes here
  `>/M(D:20260101000000Z)>>\nendobj\n`,
  `5 0 obj\n<</Type/Annot/Subtype/Widget/FT/Sig/T(Sig1)/Rect[20 20 140 70]/F 132/P 3 0 R/V 4 0 R>>\nendobj\n`,
];

function assemble(ranges, offsets, hex) {
  const [o1, o2, o3, o4pre, o4post, o5] = objs(ranges);
  const head = "%PDF-1.7\n";
  const body = head + o1 + o2 + o3 + o4pre + hex + o4post + o5;
  const xrefPos = body.length;
  const entry = (n) => `${pad(n)} 00000 n \n`;
  const xref =
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets.map(entry).join("") +
    `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return body + xref;
}

const zeros = "0".repeat(HEX);
const blank = `0 ${pad(0)} ${pad(0)} ${pad(0)}`;
// Pass 1: measure object offsets (all fixed-width, so they do not move).
const first = assemble(blank, [0, 0, 0, 0, 0], zeros);
const find = (s) => first.indexOf(s);
const offsets = [1, 2, 3, 4, 5].map((n) => find(`\n${n} 0 obj\n`) + 1);
const text = assemble(blank, offsets, zeros);
const contentsStart = text.indexOf("/Contents <") + "/Contents <".length;
const b1 = contentsStart - 1;
const c = contentsStart + HEX + 1;
const ranges = `0 ${pad(b1)} ${pad(c)} ${pad(text.length - c)}`;
const buf = Buffer.from(assemble(ranges, offsets, zeros), "latin1");

const signedBytes = Buffer.concat([buf.subarray(0, b1), buf.subarray(c)]);
writeFileSync(join(dir, "data.bin"), signedBytes);
const run = (...a) => execFileSync("openssl", a, { cwd: dir, stdio: "pipe" });
run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "k.pem",
  "-out", "c.pem", "-days", "3650", "-subj", "/CN=PDFKit Test Signer");
run("cms", "-sign", "-binary", "-in", "data.bin", "-signer", "c.pem",
  "-inkey", "k.pem", "-outform", "DER", "-out", "sig.der", "-md", "sha256");
const hex = readFileSync(join(dir, "sig.der")).toString("hex");
if (hex.length > HEX) throw new Error("signature larger than placeholder");
buf.write(hex.padEnd(HEX, "0"), contentsStart, "latin1");
writeFileSync(new URL("../fixtures/signed.pdf", import.meta.url), buf);
console.log("wrote fixtures/signed.pdf", buf.length, "bytes");
