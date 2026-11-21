import { describe, expect, it } from "vitest";
import { QpdfJob, type QpdfEngine, type QpdfRun } from "@/lib/qpdf/qpdf-runner";
import {
  QpdfStamper,
  SOURCE_PATH,
  StampError,
  overlayArgs,
  passwordArgs,
} from "./qpdf-stamper";

/**
 * A qpdf engine over a Map. `answer` decides each run's result; a
 * successful run "writes" its last argument (the output file).
 */
function fakeQpdf(answer: (args: string[]) => QpdfRun = () => ok()) {
  const files = new Map<string, Uint8Array>();
  const runs: string[][] = [];
  const engine: QpdfEngine = {
    run: (args) => {
      runs.push([...args]);
      const result = answer([...args]);
      if (result.code !== 2)
        files.set(args[args.length - 1], new Uint8Array([37, 80]));
      return result;
    },
    writeFile: (path, bytes) => void files.set(path, bytes),
    readFile: (path) => files.get(path)!,
    exists: (path) => files.has(path),
    remove: (path) => void files.delete(path),
    withJob: (fn) => {
      const job = new QpdfJob("/job-1");
      try {
        return fn(job);
      } finally {
        for (const path of job.paths()) files.delete(path);
      }
    },
  };
  return { engine, files, runs };
}

function ok(code = 0, stderr = ""): QpdfRun {
  return { code, stdout: "", stderr };
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
    const { engine, files } = fakeQpdf();
    const stamper = new QpdfStamper(engine);
    stamper.load(new Uint8Array([9]));
    expect(files.get(SOURCE_PATH)).toEqual(new Uint8Array([9]));
    stamper.unload();
    stamper.unload();
    expect(files.has(SOURCE_PATH)).toBe(false);
  });

  it("stamps the whole document and cleans up its job files", () => {
    const { engine, files, runs } = fakeQpdf(() => ok(3, "WARNING: repaired"));
    const stamper = new QpdfStamper(engine);
    stamper.load(new Uint8Array([9]));
    const out = stamper.stampDocument("pw", {
      stamp: STAMP,
      layer: "under",
      to: [0, 2],
      from: [0, 0],
    });
    expect(Array.from(out)).toEqual([37, 80]);
    expect(runs).toEqual([
      [
        "--password=pw",
        SOURCE_PATH,
        "--underlay",
        "/job-1-stamp.pdf",
        "--to=1,3",
        "--from=1,1",
        "--",
        "/job-1-out.pdf",
      ],
    ]);
    expect([...files.keys()]).toEqual([SOURCE_PATH]);
  });

  it("previews one page, with or without a stamp", () => {
    const { engine, runs } = fakeQpdf();
    const stamper = new QpdfStamper(engine);
    stamper.stampPreview("", 4, null);
    stamper.stampPreview("", 4, { stamp: STAMP, layer: "over" });
    expect(runs).toEqual([
      [SOURCE_PATH, "--pages", ".", "5", "--", "/job-1-preview.pdf"],
      [
        SOURCE_PATH,
        "--pages",
        ".",
        "5",
        "--",
        "--overlay",
        "/job-1-stamp.pdf",
        "--to=1",
        "--from=1",
        "--",
        "/job-1-preview.pdf",
      ],
    ]);
  });

  it("explains a failure in the user's words", () => {
    const { engine } = fakeQpdf(() =>
      ok(2, "qpdf: /watermark-source.pdf: can't find startxref"),
    );
    const stamper = new QpdfStamper(engine);
    expect(() => stamper.stampPreview("", 0, null)).toThrow(StampError);
    expect(() => stamper.stampPreview("", 0, null)).toThrow(
      "This does not look like a valid PDF file, or it is damaged.",
    );
  });
});
