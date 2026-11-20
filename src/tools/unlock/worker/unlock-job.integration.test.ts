// @vitest-environment node
/**
 * The unlock job against the real qpdf WebAssembly build and the committed
 * fixtures: the same cases as the manual test checklist in the README.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import { loadNodeQpdf } from "@/lib/qpdf/test-utils/node-qpdf";
import { toArrayBuffer } from "@/lib/pdfium/test-utils/node-pdfium";
import { unlockPdf } from "./unlock-job";

const fixture = (name: string) =>
  toArrayBuffer(
    readFileSync(new URL(`../../../../fixtures/${name}`, import.meta.url)),
  );

let qpdf: QpdfRunner;
beforeAll(async () => {
  qpdf = await loadNodeQpdf();
});

describe("unlockPdf with real qpdf", () => {
  it("reports an unencrypted PDF", () => {
    expect(unlockPdf(qpdf, { data: fixture("plain.pdf") })).toEqual({
      status: "not-encrypted",
    });
  });

  it("removes owner restrictions without a password", () => {
    const result = unlockPdf(qpdf, { data: fixture("owner-restricted.pdf") });
    expect(result).toMatchObject({ status: "unlocked", via: "owner" });
    if (result.status !== "unlocked") throw new Error("unreachable");
    // the output is no longer encrypted
    const check = qpdf.withJob((job) => {
      const path = job.path("check.pdf");
      qpdf.writeFile(path, new Uint8Array(result.data));
      return qpdf.run(["--requires-password", path]);
    });
    expect(check).toMatchObject({ code: 2, stderr: "" });
  });

  it("asks for, rejects and accepts the user password", () => {
    const data = () => fixture("user-password.pdf");
    expect(unlockPdf(qpdf, { data: data() })).toEqual({
      status: "password-required",
    });
    expect(unlockPdf(qpdf, { data: data(), password: "nope" })).toEqual({
      status: "wrong-password",
    });
    expect(
      unlockPdf(qpdf, { data: data(), password: "hunter2" }),
    ).toMatchObject({ status: "unlocked", via: "password" });
  });

  it("explains a file that is not a PDF", () => {
    const result = unlockPdf(qpdf, {
      data: new TextEncoder().encode("hello").buffer as ArrayBuffer,
    });
    expect(result).toMatchObject({
      status: "error",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
  });
});
