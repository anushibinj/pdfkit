import { describe, expect, it } from "vitest";
import type { QpdfRun } from "@/lib/qpdf/qpdf-runner";
import { FakeQpdfRunner } from "@/lib/qpdf/test-utils/fake-qpdf";
import {
  QpdfStamper,
  SOURCE_PATH,
  StampError,
  overlayArgs,
  passwordArgs,
} from "./qpdf-stamper";

/**
 * A fake qpdf whose runs answer with `result`; a run that does not fail
 * "writes" its last argument (the output file).
 */
function fakeQpdf(result: QpdfRun = { code: 0, stderr: "" }) {
  const qpdf = new FakeQpdfRunner((args, files) => {
    if (result.code !== 2)
      files.set(args[args.length - 1], new Uint8Array([37, 80]));
    return result;
  });
  // A fixed token gives predictable file names: /job-1-in.pdf, ...
  return { qpdf, stamper: new QpdfStamper(qpdf, () => "1") };
}

const STAMP = new Uint8Array([1]);

describe("passwordArgs", () => {
  it("adds the option only for a non-empty password", () => {
    expect(passwordArgs("")).toEqual([]);
    expect(passwordArgs("p w")).toEqual(["--password=p w"]);
  });
});

describe("overlayArgs", () => {
  it("writes the layer and the 1-based page mapping", () => {
    expect(
      overlayArgs("/s.pdf", {
        layer: "over",
        to: [0, 1, 2, 5],
        from: [0, 0, 1, 0],
      }),
    ).toEqual(["--overlay", "/s.pdf", "--to=1-3,6", "--from=1,1-2,1", "--"]);
    expect(
      overlayArgs("/s.pdf", { layer: "under", to: [0], from: [0] })[0],
    ).toBe("--underlay");
  });
});

describe("QpdfStamper", () => {
  it("keeps the source until it is unloaded", () => {
    const { qpdf, stamper } = fakeQpdf();
    stamper.load(new Uint8Array([9]));
    expect(qpdf.files.get(SOURCE_PATH)).toEqual(new Uint8Array([9]));
    stamper.unload();
    stamper.unload();
    expect(qpdf.files.has(SOURCE_PATH)).toBe(false);
  });

  it("stamps the whole document and cleans up its job files", () => {
    const { qpdf, stamper } = fakeQpdf({
      code: 3,
      stderr: "WARNING: repaired",
    });
    stamper.load(new Uint8Array([9]));
    const out = stamper.stampDocument("pw", {
      stamp: STAMP,
      layer: "under",
      to: [0, 2],
      from: [0, 0],
    });
    expect(Array.from(out)).toEqual([37, 80]);
    expect(qpdf.runs).toEqual([
      [
        "--password=pw",
        SOURCE_PATH,
        "--underlay",
        "/job-1-in.pdf",
        "--to=1,3",
        "--from=1,1",
        "--",
        "/job-1-out.pdf",
      ],
    ]);
    // the job's files are gone, the kept source is not
    expect([...qpdf.files.keys()]).toEqual([SOURCE_PATH]);
  });

  it("previews one page, with or without a stamp", () => {
    const { qpdf, stamper } = fakeQpdf();
    stamper.stampPreview("", 4, null);
    stamper.stampPreview("", 4, { stamp: STAMP, layer: "over" });
    expect(qpdf.runs).toEqual([
      [SOURCE_PATH, "--pages", ".", "5", "--", "/job-1-out.pdf"],
      [
        SOURCE_PATH,
        "--pages",
        ".",
        "5",
        "--",
        "--overlay",
        "/job-1-in.pdf",
        "--to=1",
        "--from=1",
        "--",
        "/job-1-out.pdf",
      ],
    ]);
  });

  it("explains a failure in the user's words", () => {
    const { qpdf, stamper } = fakeQpdf({
      code: 2,
      stderr: "qpdf: /watermark-source.pdf: can't find startxref",
    });
    expect(() => stamper.stampPreview("", 0, null)).toThrow(StampError);
    expect(() => stamper.stampPreview("", 0, null)).toThrow(
      "This does not look like a valid PDF file, or it is damaged.",
    );
    expect(qpdf.files.size).toBe(0); // nothing left behind after a failure
  });
});
