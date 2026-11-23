import { describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK } from "@/lib/qpdf/qpdf-output";
import { FakeQpdfRunner } from "@/lib/qpdf/test-utils/fake-qpdf";
import { QpdfLosslessOptimizer } from "./qpdf-optimizer";

describe("QpdfLosslessOptimizer", () => {
  it("passes unencrypted PDFs straight through", () => {
    const runner = new FakeQpdfRunner((args) => {
      if (args.includes("--requires-password")) {
        return { code: 2, stderr: "" }; // EXIT_NOT_ENCRYPTED
      }
      return { code: EXIT_OK, stderr: "" };
    });
    const optimizer = new QpdfLosslessOptimizer(runner);
    const input = new Uint8Array([1, 2, 3, 4]);
    const res = optimizer.probeAndDecryptIfNeeded(input);
    expect(res).toEqual({ status: "ok", bytes: input, wasEncrypted: false });
  });

  it("requests password when encrypted without password and rejects wrong password", () => {
    const runner = new FakeQpdfRunner((args) => {
      if (args.includes("--requires-password")) {
        return { code: 0, stderr: "" }; // EXIT_USER_PASSWORD
      }
      return { code: EXIT_ERROR, stderr: "invalid password" };
    });
    const optimizer = new QpdfLosslessOptimizer(runner);
    const input = new Uint8Array([1, 2, 3, 4]);

    expect(optimizer.probeAndDecryptIfNeeded(input)).toEqual({
      status: "password-required",
      wrongPassword: false,
    });
    expect(optimizer.probeAndDecryptIfNeeded(input, "wrong")).toEqual({
      status: "password-required",
      wrongPassword: true,
    });
  });

  it("runs Issue #20 qpdf lossless flags and returns output only when smaller", () => {
    const runner = new FakeQpdfRunner((args, files) => {
      const outPath = args[args.length - 1];
      files.set(outPath, new Uint8Array(40));
      return { code: EXIT_OK, stderr: "" };
    });
    const optimizer = new QpdfLosslessOptimizer(runner);
    const input = new Uint8Array(100);
    const res = optimizer.optimize(input);

    expect(res?.bytes.length).toBe(40);
    expect(runner.runs[0]).toEqual(
      expect.arrayContaining([
        "--object-streams=generate",
        "--recompress-flate",
        "--compression-level=9",
        "--remove-unreferenced-resources=yes",
      ]),
    );
    expect(runner.files.size).toBe(0); // scratch files cleaned up

    // When output is larger than input, returns null
    const biggerRunner = new FakeQpdfRunner((args, files) => {
      const outPath = args[args.length - 1];
      files.set(outPath, new Uint8Array(120));
      return { code: EXIT_OK, stderr: "" };
    });
    expect(new QpdfLosslessOptimizer(biggerRunner).optimize(input)).toBeNull();
  });
});
