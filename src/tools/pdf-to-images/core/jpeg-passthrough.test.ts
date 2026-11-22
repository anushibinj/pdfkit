import { describe, expect, it } from "vitest";
import {
  COLORSPACE,
  canKeepOriginalJpeg,
  iccDataColourSpace,
} from "./jpeg-passthrough";

/** A fake ICC profile: a 128-byte header with the given data colour space. */
function profile(space: string): Uint8Array {
  const bytes = new Uint8Array(128);
  bytes.set(
    [...space].map((c) => c.charCodeAt(0)),
    16,
  );
  return bytes;
}

describe("iccDataColourSpace", () => {
  it("reads the four-character signature at bytes 16-19", () => {
    expect(iccDataColourSpace(profile("RGB "))).toBe("RGB ");
    expect(iccDataColourSpace(profile("CMYK"))).toBe("CMYK");
  });

  it("returns null for data too short to be a profile", () => {
    expect(iccDataColourSpace(new Uint8Array(19))).toBeNull();
  });
});

describe("canKeepOriginalJpeg", () => {
  const jpeg = (colorspace: number, iccColourSpace: string | null = null) =>
    canKeepOriginalJpeg({ filters: ["DCTDecode"], colorspace, iccColourSpace });

  it.each([
    ["DeviceGray", COLORSPACE.DEVICE_GRAY],
    ["DeviceRGB", COLORSPACE.DEVICE_RGB],
    ["CalGray", COLORSPACE.CAL_GRAY],
    ["CalRGB", COLORSPACE.CAL_RGB],
  ])("keeps a %s JPEG", (_name, colorspace) => {
    expect(jpeg(colorspace)).toBe(true);
  });

  it("keeps an ICC-tagged JPEG only for gray or RGB profiles", () => {
    expect(jpeg(COLORSPACE.ICC_BASED, "RGB ")).toBe(true);
    expect(jpeg(COLORSPACE.ICC_BASED, "GRAY")).toBe(true);
    expect(jpeg(COLORSPACE.ICC_BASED, "CMYK")).toBe(false);
    expect(jpeg(COLORSPACE.ICC_BASED, null)).toBe(false);
  });

  it.each([
    ["DeviceCMYK", COLORSPACE.DEVICE_CMYK],
    ["Lab", COLORSPACE.LAB],
    ["Separation", COLORSPACE.SEPARATION],
    ["DeviceN", COLORSPACE.DEVICE_N],
    ["Indexed", COLORSPACE.INDEXED],
    ["unknown", COLORSPACE.UNKNOWN],
  ])("decodes a %s JPEG instead", (_name, colorspace) => {
    expect(jpeg(colorspace)).toBe(false);
  });

  it("accepts the inline-image abbreviation and refuses other filters", () => {
    const rgb = { colorspace: COLORSPACE.DEVICE_RGB, iccColourSpace: null };
    expect(canKeepOriginalJpeg({ ...rgb, filters: ["DCT"] })).toBe(true);
    expect(canKeepOriginalJpeg({ ...rgb, filters: ["FlateDecode"] })).toBe(
      false,
    );
    expect(canKeepOriginalJpeg({ ...rgb, filters: ["JPXDecode"] })).toBe(false);
    expect(canKeepOriginalJpeg({ ...rgb, filters: [] })).toBe(false);
    expect(
      canKeepOriginalJpeg({ ...rgb, filters: ["FlateDecode", "DCTDecode"] }),
    ).toBe(false);
  });
});
