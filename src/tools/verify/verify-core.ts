import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import type { SignatureReport } from "./messages";
import { findSignatures, type FoundSignature } from "@/lib/pdf-signature-scan";

// The byte scanner is shared with Protect PDF; re-exported so existing
// imports keep working.
export { findSignatures, type FoundSignature } from "@/lib/pdf-signature-scan";

let engineReady = false;
function ensureEngine() {
  if (engineReady) return;
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) throw new Error("Web Crypto is not available");
  pkijs.setEngine("pdfkit", new pkijs.CryptoEngine({ name: "pdfkit", crypto }));
  engineReady = true;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function signerName(
  signed: pkijs.SignedData,
  signerIndex: number,
): string | undefined {
  const sid = signed.signerInfos[signerIndex]?.sid;
  const certs = (signed.certificates ?? []).filter(
    (c): c is pkijs.Certificate => c instanceof pkijs.Certificate,
  );
  const cert =
    certs.find((c) => {
      if (sid instanceof pkijs.IssuerAndSerialNumber) {
        return (
          c.issuer.isEqual(sid.issuer) &&
          c.serialNumber.isEqual(sid.serialNumber)
        );
      }
      return false;
    }) ?? certs[0];
  if (!cert) return undefined;
  const cn = cert.subject.typesAndValues.find((t) => t.type === "2.5.4.3");
  const value = cn?.value.valueBlock.value;
  if (typeof value === "string" && value) return value;
  return cert.subject.typesAndValues
    .map((t) => String(t.value.valueBlock.value))
    .join(", ");
}

/** Verify one signature against the file bytes. Never throws. */
export async function verifyOne(
  pdf: Uint8Array,
  sig: FoundSignature,
  index: number,
): Promise<SignatureReport> {
  const [a, b, c, d] = sig.byteRange;
  const coversWholeFile = c + d === pdf.length;
  const base = { index, coversWholeFile };
  try {
    ensureEngine();
    const parsed = asn1js.fromBER(
      sig.contents.buffer.slice(
        sig.contents.byteOffset,
        sig.contents.byteOffset + sig.contents.byteLength,
      ) as ArrayBuffer,
    );
    if (parsed.offset === -1) {
      return {
        ...base,
        status: "unsupported",
        reason: "Signature data is not valid ASN.1/CMS.",
      };
    }
    const info = new pkijs.ContentInfo({ schema: parsed.result });
    if (info.contentType !== pkijs.ContentInfo.SIGNED_DATA) {
      return {
        ...base,
        status: "unsupported",
        reason: "Signature is not a CMS SignedData container.",
      };
    }
    const signed = new pkijs.SignedData({ schema: info.content });
    if (signed.signerInfos.length === 0) {
      return {
        ...base,
        status: "invalid",
        reason: "Signature contains no signer.",
      };
    }
    const signedBytes = concat(pdf.subarray(a, a + b), pdf.subarray(c, c + d));
    let allOk = true;
    let failure = "";
    for (let s = 0; s < signed.signerInfos.length; s++) {
      const res = await signed.verify({
        signer: s,
        data: signedBytes.buffer.slice(
          signedBytes.byteOffset,
          signedBytes.byteOffset + signedBytes.byteLength,
        ) as ArrayBuffer,
        checkChain: false, // trust chain intentionally not evaluated
        extendedMode: true,
      });
      if (!res.signatureVerified) {
        allOk = false;
        failure =
          res.message ||
          "The document was changed after signing, or the signature does not match.";
        break;
      }
    }
    const signer = signerName(signed, 0);
    return allOk
      ? { ...base, status: "valid", signer }
      : { ...base, status: "invalid", signer, reason: failure };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // pkijs throws for missing signer certs, unknown algorithms, etc.
    return {
      ...base,
      status: /certificate|algorithm|unsupported/i.test(message)
        ? "unsupported"
        : "invalid",
      reason: message,
    };
  }
}

export async function verifyPdf(pdf: Uint8Array): Promise<SignatureReport[]> {
  const { found, skipped } = findSignatures(pdf);
  const reports: SignatureReport[] = [];
  for (let i = 0; i < found.length; i++) {
    reports.push(await verifyOne(pdf, found[i], i));
  }
  for (let i = 0; i < skipped; i++) {
    reports.push({
      index: found.length + i,
      status: "unsupported",
      reason: "A signature field could not be read.",
      coversWholeFile: false,
    });
  }
  return reports;
}
