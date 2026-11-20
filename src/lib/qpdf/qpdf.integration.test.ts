// @vitest-environment node
/**
 * The shared qpdf loader and runner against the real WebAssembly build.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK, isInvalidPassword } from "./qpdf-output";
import type { QpdfRunner } from "./qpdf-runner";
import { loadNodeQpdf } from "./test-utils/node-qpdf";

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url)),
  );

let qpdf: QpdfRunner;
beforeAll(async () => {
  qpdf = await loadNodeQpdf();
});

describe("qpdf in WebAssembly", () => {
  it("captures standard output", () => {
    const run = qpdf.run(["--version"]);
    expect(run.code).toBe(EXIT_OK);
    expect(run.stdout).toMatch(/version 11\./);
  });

  it("captures standard error, per run", () => {
    const run = qpdf.withJob((job) => {
      const input = job.path("in.pdf");
      qpdf.writeFile(input, fixture("user-password.pdf"));
      return qpdf.run(["--check", "--password=nope", input]);
    });
    expect(run.code).toBe(EXIT_ERROR);
    expect(isInvalidPassword(run.stderr)).toBe(true);
    expect(qpdf.run(["--version"]).stderr).toBe("");
  });

  it("leaves no files behind after a job", () => {
    let input = "";
    qpdf.withJob((job) => {
      input = job.path("in.pdf");
      qpdf.writeFile(input, fixture("plain.pdf"));
    });
    expect(qpdf.exists(input)).toBe(false);
  });
});
