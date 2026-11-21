import { describe, expect, it, vi } from "vitest";
import { readSingleFile } from "./read-single-file";

/** A notifier whose messages the test can inspect. */
const notifier = () => ({ info: vi.fn(), error: vi.fn() });
/** The plain-text reader, as the Markdown page uses it. */
const text = (file: File) => file.text();

describe("readSingleFile", () => {
  it("reads the file with the given reader", async () => {
    const notify = notifier();
    const file = new File(["hello"], "a.md");
    expect(await readSingleFile([file], 100, text, notify)).toEqual({
      file,
      content: "hello",
    });
    expect(notify.info).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("opens only the first of several files and says so", async () => {
    const notify = notifier();
    const opened = await readSingleFile(
      [new File(["1"], "first.md"), new File(["2"], "second.md")],
      100,
      text,
      notify,
    );
    expect(opened?.content).toBe("1");
    expect(notify.info).toHaveBeenCalledWith(
      "Opened first.md. One file at a time.",
    );
  });

  it("refuses a file over the limit without reading it", async () => {
    const notify = notifier();
    const read = vi.fn(text);
    const big = new File(["x"], "big.md");
    Object.defineProperty(big, "size", { value: 2048 });
    expect(await readSingleFile([big], 1024, read, notify)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith("big.md is over 1 KB.");
  });

  it("reports a read failure instead of throwing", async () => {
    const notify = notifier();
    /** A reader that fails like a file removed after it was picked. */
    const failing = async () => {
      throw new DOMException("gone", "NotFoundError");
    };
    expect(
      await readSingleFile([new File(["x"], "a.md")], 100, failing, notify),
    ).toBeNull();
    expect(notify.error).toHaveBeenCalledWith("Could not read a.md.");
  });

  it("does nothing for an empty list", async () => {
    const notify = notifier();
    expect(await readSingleFile([], 100, text, notify)).toBeNull();
    expect(notify.info).not.toHaveBeenCalled();
  });
});
