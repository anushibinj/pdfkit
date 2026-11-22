import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlobImage } from "./blob-image";

let counter = 0;
const create = vi.fn(() => `blob:test/${++counter}`);
const revoke = vi.fn();

beforeEach(() => {
  counter = 0;
  create.mockClear();
  revoke.mockClear();
  // jsdom does not implement object URLs
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
});
afterEach(() => vi.restoreAllMocks());

describe("BlobImage", () => {
  it("shows the blob through an object URL and revokes it on unmount", () => {
    const blob = new Blob(["x"], { type: "image/png" });
    const { getByRole, unmount } = render(
      <BlobImage blob={blob} alt="Page 1" />,
    );
    const img = getByRole("img", { name: "Page 1" });
    expect(create).toHaveBeenCalledWith(blob);
    const url = img.getAttribute("src");
    expect(url).toMatch(/^blob:test\//);
    unmount();
    expect(revoke).toHaveBeenCalledWith(url);
  });

  it("replaces the URL when the blob changes, revoking the old one", () => {
    const first = new Blob(["a"]);
    const second = new Blob(["b"]);
    const { getByRole, rerender } = render(<BlobImage blob={first} alt="x" />);
    const before = getByRole("img").getAttribute("src");
    rerender(<BlobImage blob={first} alt="x" />);
    expect(getByRole("img").getAttribute("src")).toBe(before); // same blob: kept
    rerender(<BlobImage blob={second} alt="x" />);
    expect(revoke).toHaveBeenCalledWith(before);
    expect(getByRole("img").getAttribute("src")).not.toBe(before);
    expect(create).toHaveBeenLastCalledWith(second);
  });
});
