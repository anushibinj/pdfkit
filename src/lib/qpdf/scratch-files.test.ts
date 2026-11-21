import { describe, expect, it } from "vitest";
import { friendlyQpdfMessage } from "./qpdf-output";
import {
  newScratchToken,
  removeScratchFiles,
  scratchFiles,
} from "./scratch-files";
import { FakeQpdfRunner } from "./test-utils/fake-qpdf";

describe("newScratchToken", () => {
  it("is unique even when the random part repeats", () => {
    const a = newScratchToken(() => 0.5);
    const b = newScratchToken(() => 0.5);
    expect(a).not.toBe(b);
  });

  it("is a counter plus a short base-36 suffix", () => {
    expect(newScratchToken(() => 0.123456789)).toMatch(/^\d+-[0-9a-z]{1,6}$/);
  });
});

describe("scratchFiles", () => {
  it("names the input, output and job files after the token", () => {
    expect(scratchFiles("7-abc")).toEqual({
      input: "/job-7-abc-in.pdf",
      output: "/job-7-abc-out.pdf",
      job: "/job-7-abc-job.json",
    });
  });

  it("uses names that friendlyQpdfMessage strips from qpdf's output", () => {
    const { input } = scratchFiles(newScratchToken());
    expect(friendlyQpdfMessage(`qpdf: ${input}: odd thing`)).toBe("Odd thing");
  });
});

describe("removeScratchFiles", () => {
  it("removes every file of the job and tolerates missing ones", () => {
    const runner = new FakeQpdfRunner();
    const files = scratchFiles("1-x");
    runner.writeFile(files.input, new Uint8Array([1]));
    runner.writeFile(files.job, new Uint8Array([2]));
    runner.writeFile("/other.pdf", new Uint8Array([3]));
    removeScratchFiles(runner, files);
    expect([...runner.files.keys()]).toEqual(["/other.pdf"]);
  });
});
