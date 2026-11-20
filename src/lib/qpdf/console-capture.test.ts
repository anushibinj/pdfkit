import { describe, expect, it } from "vitest";
import { ConsoleCapture, type CapturableConsole } from "./console-capture";

function fakeConsole(): CapturableConsole {
  return { log: () => {}, warn: () => {} };
}

describe("ConsoleCapture", () => {
  it("routes console.log to stdout and console.warn to stderr", () => {
    const target = fakeConsole();
    const capture = new ConsoleCapture();
    capture.install(target);
    target.log("version", 11);
    target.warn("qpdf:", "/job-1-in.pdf: invalid password");
    expect(capture.stdout()).toBe("version 11");
    expect(capture.stderr()).toBe("qpdf: /job-1-in.pdf: invalid password");
  });

  it("joins lines with newlines and forgets them on reset", () => {
    const capture = new ConsoleCapture();
    capture.writeErr("a");
    capture.writeErr("b");
    capture.writeOut("c");
    expect(capture.stderr()).toBe("a\nb");
    capture.reset();
    expect(capture.stderr()).toBe("");
    expect(capture.stdout()).toBe("");
  });

  it("keeps functions bound before a re-install writing to the same buffers", () => {
    const target = fakeConsole();
    const capture = new ConsoleCapture();
    capture.install(target);
    const boundEarlier = target.warn.bind(target);
    capture.install(target);
    boundEarlier("from the first qpdf instance");
    target.warn("from the second");
    expect(capture.stderr()).toBe(
      "from the first qpdf instance\nfrom the second",
    );
  });
});
