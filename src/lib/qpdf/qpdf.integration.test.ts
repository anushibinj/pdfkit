// @vitest-environment node
/** The shared qpdf layer against the real qpdf 11 WebAssembly build. */
import { beforeAll, describe, expect, it } from "vitest";
import { probeEncryption } from "./encryption-status";
import { EXIT_ERROR, EXIT_OK, EXIT_WARNINGS } from "./qpdf-output";
import { runQpdfJob } from "./qpdf-job";
import type { QpdfRunner } from "./qpdf-runner";
import { removeScratchFiles, scratchFiles } from "./scratch-files";
import { loadNodeQpdf, readFixture } from "./test-utils/node-qpdf";

let qpdf: QpdfRunner;

beforeAll(async () => {
  qpdf = await loadNodeQpdf();
}, 60_000);

/** Write `bytes` as a job's input, run `fn`, and always clean up. */
function withInput<T>(bytes: Uint8Array, fn: (input: string) => T): T {
  const files = scratchFiles(`it-${Math.random().toString(36).slice(2)}`);
  qpdf.writeFile(files.input, bytes);
  try {
    return fn(files.input);
  } finally {
    removeScratchFiles(qpdf, files);
  }
}

describe("qpdf runner (real WASM)", () => {
  it("runs qpdf and captures its stderr", () => {
    const result = qpdf.run(["--check", "/does-not-exist.pdf"]);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toMatch(/does-not-exist\.pdf/);
  });

  it("keeps each run's stderr separate", () => {
    qpdf.run(["--check", "/missing-a.pdf"]);
    const second = qpdf.run(["--check", "/missing-b.pdf"]);
    expect(second.stderr).toMatch(/missing-b/);
    expect(second.stderr).not.toMatch(/missing-a/);
  });
});

describe("probeEncryption (real WASM)", () => {
  it.each([
    ["plain.pdf", "not-encrypted"],
    ["owner-restricted.pdf", "opens-without-password"],
    ["user-password.pdf", "password-required"],
  ])("%s is %s", (fixture, kind) => {
    expect(
      withInput(readFixture(fixture), (p) => probeEncryption(qpdf, p)),
    ).toEqual({
      kind,
    });
  });

  it("reports a file that is not a PDF as unreadable", () => {
    const junk = new TextEncoder().encode("hello, not a pdf");
    expect(withInput(junk, (p) => probeEncryption(qpdf, p))).toEqual({
      kind: "unreadable",
      message: "This does not look like a valid PDF file, or it is damaged.",
    });
  });
});

describe("runQpdfJob (real WASM)", () => {
  it("passes passwords that the command line would misread", () => {
    // "@..." would be read as an argument file, "--" ends --encrypt's list.
    for (const password of ["@secret", "--", "--print=none", 'q"uo\\te']) {
      withInput(readFixture("plain.pdf"), (input) => {
        const output = input.replace("-in.pdf", "-out.pdf");
        const job = input.replace("-in.pdf", "-job.json");
        const encrypted = runQpdfJob(qpdf, job, {
          inputFile: input,
          outputFile: output,
          encrypt: {
            userPassword: password,
            ownerPassword: password,
            "256bit": {},
          },
        });
        expect(encrypted.code).toBe(EXIT_OK);
        expect(qpdf.exists(job)).toBe(false);
        expect(probeEncryption(qpdf, output)).toEqual({
          kind: "password-required",
        });
        const check = runQpdfJob(qpdf, job, {
          inputFile: output,
          password,
          requiresPassword: "",
        });
        expect(check.code).toBe(EXIT_WARNINGS);
      });
    }
  });
});
