import { describe, expect, it } from "vitest";
import {
  BYTES_PER_MB,
  computeTargetImageDimensions,
  DEFAULT_COMPRESS_OPTIONS,
  fnv1aHash64,
  mbToBytes,
  resolvePresetConfig,
  serializeCompressPlan,
  validateCompressOptions,
} from "./options";

describe("compress core options", () => {
  it("converts megabytes to bytes reliably", () => {
    expect(mbToBytes(2)).toBe(2 * BYTES_PER_MB);
    expect(mbToBytes(0.5)).toBe(0.5 * BYTES_PER_MB);
    expect(mbToBytes(0)).toBe(0);
    expect(mbToBytes(-1)).toBe(0);
    expect(mbToBytes(Number.NaN)).toBe(0);
  });

  it("validates custom and target-size options", () => {
    expect(validateCompressOptions(DEFAULT_COMPRESS_OPTIONS)).toBeNull();
    expect(
      validateCompressOptions({ ...DEFAULT_COMPRESS_OPTIONS, preset: "custom", dpi: 10 }),
    ).toMatch(/DPI/i);
    expect(
      validateCompressOptions({ ...DEFAULT_COMPRESS_OPTIONS, preset: "custom", quality: 0.02 }),
    ).toMatch(/Quality/i);
    expect(
      validateCompressOptions({
        ...DEFAULT_COMPRESS_OPTIONS,
        preset: "target-size",
        targetSizeMb: 0.01,
      }),
    ).toMatch(/Target size/i);
  });

  it("resolves every preset to expected concrete config", () => {
    expect(resolvePresetConfig({ ...DEFAULT_COMPRESS_OPTIONS, preset: "lossless" })).toEqual({
      lossless: true,
      targetDpi: 0,
      quality: 1.0,
      grayscale: false,
    });
    expect(resolvePresetConfig({ ...DEFAULT_COMPRESS_OPTIONS, preset: "balanced" })).toEqual({
      lossless: false,
      targetDpi: 150,
      quality: 0.75,
      grayscale: false,
    });
    expect(resolvePresetConfig({ ...DEFAULT_COMPRESS_OPTIONS, preset: "small" })).toEqual({
      lossless: false,
      targetDpi: 100,
      quality: 0.6,
      grayscale: false,
    });
    expect(
      resolvePresetConfig({
        ...DEFAULT_COMPRESS_OPTIONS,
        preset: "custom",
        dpi: 200,
        quality: 0.85,
        grayscale: true,
      }),
    ).toEqual({
      lossless: false,
      targetDpi: 200,
      quality: 0.85,
      grayscale: true,
    });
  });

  it("matches Rust fnv1a_hash64 digest for test vectors", () => {
    expect(fnv1aHash64(new Uint8Array(0))).toBe(BigInt("0xcbf29ce484222325"));
    expect(fnv1aHash64(new TextEncoder().encode("hello"))).toBe(
      BigInt("0xa430d84680aabd0b"),
    );
  });

  it("computes target image dimensions without upscaling or unnecessary downsampling", () => {
    // 600x300 drawn into 72x36 pt (600 DPI) -> 150 DPI => 150x75
    expect(computeTargetImageDimensions(600, 300, 72, 36, 150)).toMatchObject({
      width: 150,
      height: 75,
      downsampled: true,
    });
    // Already 100 DPI -> target 150 DPI => untouched
    expect(computeTargetImageDimensions(100, 100, 72, 72, 150)).toMatchObject({
      width: 100,
      height: 100,
      downsampled: false,
    });
    // Zero target DPI disables downsampling
    expect(computeTargetImageDimensions(1200, 800, 72, 48, 0)).toMatchObject({
      width: 1200,
      height: 800,
      downsampled: false,
    });
  });

  it("serializes binary PCMP v1 compression plan with replacements", () => {
    const buf = serializeCompressPlan(
      { lossless: false, targetDpi: 150, quality: 0.75, grayscale: true },
      [
        {
          rawHash: BigInt("0x123456789abcdef0"),
          originalWidth: 800,
          originalHeight: 600,
          newWidth: 400,
          newHeight: 300,
          grayscale: true,
          jpegBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        },
      ],
    );
    expect(new TextDecoder().decode(buf.subarray(0, 4))).toBe("PCMP");
    const view = new DataView(buf.buffer);
    expect(view.getUint32(4, true)).toBe(1); // version
    expect(view.getUint32(8, true)).toBe(2); // grayscale bit set, lossless bit clear
    expect(view.getUint32(12, true)).toBe(150);
    expect(view.getUint32(16, true)).toBe(75);
    expect(view.getUint32(20, true)).toBe(1);
    expect(view.getBigUint64(24, true)).toBe(BigInt("0x123456789abcdef0"));
    expect(view.getUint32(24 + 28, true)).toBe(4);
    expect(Array.from(buf.subarray(24 + 32))).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });
});
