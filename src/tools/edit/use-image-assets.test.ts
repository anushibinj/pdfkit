import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageAsset } from "./core/model";
import { useImageAssets } from "./use-image-assets";

const asset = (id: string): ImageAsset => ({
  id,
  mime: "image/png",
  bytes: new ArrayBuffer(4),
  pixelWidth: 1,
  pixelHeight: 1,
});

let created = 0;
const revoke = vi.fn();

beforeEach(() => {
  created = 0;
  revoke.mockClear();
  // jsdom does not implement object URLs
  Object.assign(URL, {
    createObjectURL: () => `blob:test/${++created}`,
    revokeObjectURL: revoke,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("useImageAssets", () => {
  it("stores images with a preview URL each", () => {
    const { result } = renderHook(() => useImageAssets());
    act(() => result.current.add(asset("a")));
    act(() => result.current.add(asset("b")));
    expect([...result.current.assets.keys()]).toEqual(["a", "b"]);
    expect(result.current.urls.get("b")).toBe("blob:test/2");
  });

  it("clear forgets the images and revokes their URLs", () => {
    const { result } = renderHook(() => useImageAssets());
    act(() => result.current.add(asset("a")));
    act(() => result.current.clear());
    expect(result.current.assets.size).toBe(0);
    expect(revoke).toHaveBeenCalledWith("blob:test/1");
    const before = result.current;
    act(() => result.current.clear());
    expect(result.current.assets).toBe(before.assets);
  });

  it("revokes the URLs on unmount", () => {
    const { result, unmount } = renderHook(() => useImageAssets());
    act(() => result.current.add(asset("a")));
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:test/1");
  });
});
