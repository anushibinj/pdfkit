// @vitest-environment node
/**
 * Runs the real qpdf WebAssembly build against the fixtures in `fixtures/`,
 * covering every branch of the encryption probe.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QpdfRunner } from "@/lib/qpdf/qpdf-runner";
import {
  loadNodeQpdf,
  readFixture,
  type NodeQpdf,
} from "@/lib/qpdf/test-utils/qpdf-node";
import type { UnlockResult } from "../messages";
import { unlockPdf } from "./unlock-job";

let node: NodeQpdf;
let qpdf: QpdfRunner;

beforeAll(async () => {
  node = await loadNodeQpdf();
  qpdf = node.runner;
}, 60_000);
afterAll(() => node?.restoreConsole());

const unlock = (fixture: string, password?: string) =>
  unlockPdf(qpdf, { data: readFixture(fixture).slice().buffer, password });

/** Ask qpdf how the unlocked file is encrypted. */
function encryptionOf(result: UnlockResult): string {
  if (result.status !== "unlocked") throw new Error(result.status);
  return qpdf.withJob((job) => {
    const path = job.write("check.pdf", new Uint8Array(result.data));
    return qpdf.run(["--show-encryption", path]).stdout;
  });
}

describe("unlockPdf with the real qpdf build", () => {
  it("reports a file that is not encrypted", () => {
    expect(unlock("plain.pdf")).toEqual({ status: "not-encrypted" });
  });

  it("removes owner restrictions without a password", () => {
    const result = unlock("owner-restricted.pdf");
    expect(result).toMatchObject({ status: "unlocked", via: "owner" });
    expect(encryptionOf(result)).toMatch(/not encrypted/);
  });

  it("asks for the password of a user-password file", () => {
    expect(unlock("user-password.pdf")).toEqual({
      status: "password-required",
    });
  });

  it("recognises a wrong password", () => {
    expect(unlock("user-password.pdf", "nope")).toEqual({
      status: "wrong-password",
    });
  });

  it("decrypts with the right password", () => {
    const result = unlock("user-password.pdf", "hunter2");
    expect(result).toMatchObject({ status: "unlocked", via: "password" });
    expect(encryptionOf(result)).toMatch(/not encrypted/);
  });

  it("explains a file that is not a PDF", () => {
    const junk = new TextEncoder().encode("not a pdf").buffer;
    expect(unlockPdf(qpdf, { data: junk })).toEqual({
      status: "error",
      reason: "failed",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
  });
});
