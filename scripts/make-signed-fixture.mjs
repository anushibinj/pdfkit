// Builds fixtures/signed.pdf: a one-page PDF with a detached CMS signature
// from a throwaway self-signed key. Requires the `openssl` CLI.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sigfix-"));
const PLACEHOLDER = 4096; // hex chars inside <...>
const pad = (n) => String(n).padStart(10, "0");

const head = `%PDF-1.7
1 0 obj<</Type/Catalog/Pages 2 0 R/AcroForm<</Fields[5 0 R]/SigFlags 3>>>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Annots[5 0 R]>>endobj
4 0 obj<</Type/Sig/Filter/Adobe.PPKLite/SubFilter/adbe.pkcs7.detached/ByteRange [0 ${pad(0)} ${pad(0)} ${pad(0)}]/Contents <`;
const mid = `>/M(D:20260101000000Z)>>endobj
5 0 obj<</Type/Annot/Subtype/Widget/FT/Sig/T(Sig1)/Rect[20 20 140 70]/F 132/P 3 0 R/V 4 0 R>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;
const zeros = "0".repeat(PLACEHOLDER);
const contentsStart = head.length; // index of first hex char
const b1 = contentsStart - 1; // length before '<'
const c = contentsStart + PLACEHOLDER + 1; // after '>'
const total = head.length + PLACEHOLDER + mid.length;
const headFixed = head.replace(
  `[0 ${pad(0)} ${pad(0)} ${pad(0)}]`,
  `[0 ${pad(b1)} ${pad(c)} ${pad(total - c)}]`,
);
const buf = Buffer.concat([
  Buffer.from(headFixed, "latin1"),
  Buffer.from(zeros),
  Buffer.from(mid, "latin1"),
]);
const signedBytes = Buffer.concat([buf.subarray(0, b1), buf.subarray(c)]);
writeFileSync(join(dir, "data.bin"), signedBytes);
const run = (...a) => execFileSync("openssl", a, { cwd: dir, stdio: "pipe" });
run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "k.pem",
  "-out", "c.pem", "-days", "3650", "-subj", "/CN=PDFKit Test Signer");
run("cms", "-sign", "-binary", "-in", "data.bin", "-signer", "c.pem",
  "-inkey", "k.pem", "-outform", "DER", "-out", "sig.der", "-md", "sha256");
const hex = readFileSync(join(dir, "sig.der")).toString("hex");
if (hex.length > PLACEHOLDER) throw new Error("signature larger than placeholder");
buf.write(hex.padEnd(PLACEHOLDER, "0"), contentsStart, "latin1");
writeFileSync(new URL("../fixtures/signed.pdf", import.meta.url), buf);
console.log("wrote fixtures/signed.pdf", buf.length, "bytes");
