import { describe, expect, it, vi } from "vitest";
import { QpdfOutput, type ConsoleLike } from "./qpdf-output";

const fakeConsole = (): ConsoleLike => ({ log: vi.fn(), warn: vi.fn() });

describe("QpdfOutput", () => {
  it("collects log as stdout and warn as stderr, one line per call", () => {
    const target = fakeConsole();
    const output = new QpdfOutput();
    output.attachTo(target);
    target.log("3");
    target.warn("qpdf:", "/job-1-in.pdf:", "invalid password");
    target.warn("second");
    expect(output.stdout()).toBe("3");
    expect(output.stderr()).toBe(
      "qpdf: /job-1-in.pdf: invalid password\nsecond",
    );
  });

  it("captures through copies bound after attaching, like the qpdf glue makes", () => {
    const target = fakeConsole();
    const output = new QpdfOutput();
    output.attachTo(target);
    const boundLog = target.log.bind(target);
    boundLog("from a bound copy");
    expect(output.stdout()).toBe("from a bound copy");
  });

  it("starts empty and forgets everything on reset", () => {
    const target = fakeConsole();
    const output = new QpdfOutput();
    expect(output.stdout()).toBe("");
    expect(output.stderr()).toBe("");
    output.attachTo(target);
    target.log("a");
    target.warn("b");
    output.reset();
    expect(output.stdout()).toBe("");
    expect(output.stderr()).toBe("");
  });

  it("stringifies non-string arguments", () => {
    const target = fakeConsole();
    const output = new QpdfOutput();
    output.attachTo(target);
    target.log(42, null, undefined);
    expect(output.stdout()).toBe("42 null undefined");
  });

  it("puts the original console methods back", () => {
    const target = fakeConsole();
    const { log, warn } = target;
    const output = new QpdfOutput();
    const restore = output.attachTo(target);
    expect(target.log).not.toBe(log);
    restore();
    expect(target.log).toBe(log);
    expect(target.warn).toBe(warn);
  });
});
