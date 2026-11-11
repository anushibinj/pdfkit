import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "./download";

describe("downloadBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clicks a temporary download link and revokes the URL later", () => {
    vi.useFakeTimers();
    // jsdom does not implement object URLs
    const create = vi.fn(() => "blob:test/1");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    const blob = new Blob(["x"]);
    downloadBlob(blob, "notes.pdf", 500);

    expect(create).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("notes.pdf");
    expect(clicked[0].getAttribute("href")).toBe("blob:test/1");
    expect(clicked[0].isConnected).toBe(false); // removed again
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(revoke).toHaveBeenCalledWith("blob:test/1");
  });
});
