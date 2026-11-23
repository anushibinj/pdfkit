/**
 * Compression option validation, preset resolution, FNV-1a hashing,
 * DPI dimension calculation, and binary `PCMP` plan serialization.
 *
 * Follows Single Responsibility Principle (SRP) by keeping pure configuration
 * transformations and wire serialization free of DOM or worker side effects.
 */

import type {
  CompressOptions,
  ImageReplacementEntry,
  ResolvedPassConfig,
} from "./model";

/** Binary protocol magic header matching `crates/pdf-compress/src/plan.rs`. */
export const PLAN_MAGIC = [0x50, 0x43, 0x4d, 0x50] as const; // "PCMP"
/** Binary protocol version matching `crates/pdf-compress/src/plan.rs`. */
export const PLAN_VERSION = 1;

/** Minimum and maximum bounds for custom DPI settings. */
export const MIN_DPI = 36;
export const MAX_DPI = 600;

/** Minimum and maximum bounds for custom JPEG quality (0.1 to 1.0). */
export const MIN_QUALITY = 0.1;
export const MAX_QUALITY = 1.0;

/** Minimum and maximum bounds for target size in MB. */
export const MIN_TARGET_MB = 0.05;
export const MAX_TARGET_MB = 500;

/** One megabyte in decimal bytes (`1024 * 1024` MiB, matching standard upload portal limits). */
export const BYTES_PER_MB = 1024 * 1024;

/** Default compression options pre-selected when opening the tool. */
export const DEFAULT_COMPRESS_OPTIONS: CompressOptions = {
  preset: "balanced",
  dpi: 150,
  quality: 0.75,
  grayscale: false,
  targetSizeMb: 2,
};

/**
 * Converts a megabyte limit into integer bytes.
 *
 * @param mb Size in megabytes.
 * @returns Byte count rounded to the nearest positive integer.
 */
export function mbToBytes(mb: number): number {
  if (!Number.isFinite(mb) || mb <= 0) return 0;
  return Math.max(1, Math.round(mb * BYTES_PER_MB));
}

/**
 * Validates user-supplied {@link CompressOptions} and returns an error message
 * when any numeric parameter is invalid or out of bounds.
 *
 * @param options Compression options to validate.
 * @returns Human-readable validation error, or `null` if valid.
 */
export function validateCompressOptions(options: CompressOptions): string | null {
  if (options.preset === "custom") {
    if (!Number.isFinite(options.dpi) || options.dpi < MIN_DPI || options.dpi > MAX_DPI) {
      return `DPI must be between ${MIN_DPI} and ${MAX_DPI}.`;
    }
    if (
      !Number.isFinite(options.quality) ||
      options.quality < MIN_QUALITY ||
      options.quality > MAX_QUALITY
    ) {
      return `Quality must be between ${Math.round(MIN_QUALITY * 100)}% and ${Math.round(MAX_QUALITY * 100)}%.`;
    }
  }

  if (options.preset === "target-size") {
    if (
      !Number.isFinite(options.targetSizeMb) ||
      options.targetSizeMb < MIN_TARGET_MB ||
      options.targetSizeMb > MAX_TARGET_MB
    ) {
      return `Target size must be between ${MIN_TARGET_MB} MB and ${MAX_TARGET_MB} MB.`;
    }
  }

  return null;
}

/**
 * Resolves a {@link CompressOptions} preset into concrete pass parameters.
 *
 * For `"target-size"`, returns the initial balanced starting configuration;
 * {@link TargetSizeSolver} iterates through the full quality ladder.
 *
 * @param options User-selected compression options.
 * @returns Concrete {@link ResolvedPassConfig}.
 */
export function resolvePresetConfig(options: CompressOptions): ResolvedPassConfig {
  switch (options.preset) {
    case "lossless":
      return {
        lossless: true,
        targetDpi: 0,
        quality: 1.0,
        grayscale: false,
      };
    case "balanced":
      return {
        lossless: false,
        targetDpi: 150,
        quality: 0.75,
        grayscale: false,
      };
    case "small":
      return {
        lossless: false,
        targetDpi: 100,
        quality: 0.6,
        grayscale: false,
      };
    case "custom":
      return {
        lossless: false,
        targetDpi: Math.round(Math.min(MAX_DPI, Math.max(MIN_DPI, options.dpi))),
        quality: Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, options.quality)),
        grayscale: options.grayscale,
      };
    case "target-size":
      return {
        lossless: false,
        targetDpi: 150,
        quality: 0.75,
        grayscale: options.grayscale,
      };
  }
}

/**
 * Computes a deterministic 64-bit FNV-1a hash over `bytes`, matching
 * `crates/pdf-compress/src/jpeg.rs::fnv1a_hash64` bit-for-bit.
 *
 * @param bytes Byte slice to hash.
 * @returns Unsigned 64-bit `bigint` hash digest.
 */
export function fnv1aHash64(bytes: Uint8Array): bigint {
  let hash = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x0100000001b3");
  const mask64 = BigInt("0xffffffffffffffff");
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * prime) & mask64;
  }
  return hash;
}

/**
 * Computes target image pixel dimensions given the image's rendered size on the page
 * (in PDF points, 72 pt = 1 inch) and a maximum target DPI ceiling.
 *
 * Rules:
 * - Never upscales an image.
 * - Skips downsampling when the image's effective DPI is already within 5% of `targetDpi`.
 * - Falls back to a conservative 300 DPI assumption when `drawnWidthPt`/`drawnHeightPt`
 *   are not positive (e.g. unmeasured placement).
 *
 * @param width Stored image width in pixels.
 * @param height Stored image height in pixels.
 * @param drawnWidthPt Maximum drawn width in PDF points.
 * @param drawnHeightPt Maximum drawn height in PDF points.
 * @param targetDpi Target DPI ceiling (`0` disables downsampling).
 * @returns Target `{ width, height, effectiveDpi, downsampled }`.
 */
export function computeTargetImageDimensions(
  width: number,
  height: number,
  drawnWidthPt: number,
  drawnHeightPt: number,
  targetDpi: number,
): { width: number; height: number; effectiveDpi: number; downsampled: boolean } {
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1, effectiveDpi: 0, downsampled: false };
  }

  let effectiveDpi = 0;
  if (drawnWidthPt > 1 && drawnHeightPt > 1) {
    const dpiX = (width * 72) / drawnWidthPt;
    const dpiY = (height * 72) / drawnHeightPt;
    effectiveDpi = Math.max(dpiX, dpiY);
  } else {
    effectiveDpi = 300;
  }

  if (targetDpi <= 0 || width <= 1 || height <= 1) {
    return { width, height, effectiveDpi, downsampled: false };
  }

  // Skip images already below or within 5% of target DPI
  if (effectiveDpi <= targetDpi * 1.05) {
    return { width, height, effectiveDpi, downsampled: false };
  }

  // Without a measured drawn box, only downsample clearly high-res images (> 400 px)
  if (!(drawnWidthPt > 1 && drawnHeightPt > 1) && Math.max(width, height) <= 400) {
    return { width, height, effectiveDpi, downsampled: false };
  }

  const scale = targetDpi / effectiveDpi;
  if (scale >= 0.98) {
    return { width, height, effectiveDpi, downsampled: false };
  }

  const nextWidth = Math.min(width, Math.max(1, Math.round(width * scale)));
  const nextHeight = Math.min(height, Math.max(1, Math.round(height * scale)));
  return {
    width: nextWidth,
    height: nextHeight,
    effectiveDpi,
    downsampled: nextWidth < width || nextHeight < height,
  };
}

/**
 * Serializes a {@link ResolvedPassConfig} and pre-encoded image replacements
 * into the binary `PCMP` v1 wire format consumed by `pdf-compress.wasm`.
 *
 * @param config Resolved single-pass configuration.
 * @param replacements Optional list of pre-encoded JPEG stream replacements.
 * @returns Binary buffer ready for transfer into WASM memory.
 */
export function serializeCompressPlan(
  config: ResolvedPassConfig,
  replacements: readonly ImageReplacementEntry[] = [],
): Uint8Array {
  const headerSize = 24;
  const entryHeaderSize = 32;
  const extraBytes = replacements.reduce(
    (sum, r) => sum + entryHeaderSize + r.jpegBytes.length,
    0,
  );
  const buffer = new ArrayBuffer(headerSize + extraBytes);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Magic "PCMP"
  bytes[0] = PLAN_MAGIC[0];
  bytes[1] = PLAN_MAGIC[1];
  bytes[2] = PLAN_MAGIC[2];
  bytes[3] = PLAN_MAGIC[3];

  view.setUint32(4, PLAN_VERSION, true);

  let flags = 0;
  if (config.lossless) flags |= 1;
  if (config.grayscale) flags |= 2;
  view.setUint32(8, flags, true);

  view.setUint32(12, Math.max(0, Math.round(config.targetDpi)), true);
  const qualityInt = Math.min(100, Math.max(1, Math.round(config.quality * 100)));
  view.setUint32(16, qualityInt, true);
  view.setUint32(20, replacements.length, true);

  let offset = headerSize;
  for (const r of replacements) {
    view.setBigUint64(offset, r.rawHash, true);
    view.setUint32(offset + 8, r.originalWidth, true);
    view.setUint32(offset + 12, r.originalHeight, true);
    view.setUint32(offset + 16, r.newWidth, true);
    view.setUint32(offset + 20, r.newHeight, true);
    view.setUint32(offset + 24, r.grayscale ? 1 : 0, true);
    view.setUint32(offset + 28, r.jpegBytes.length, true);
    offset += entryHeaderSize;
    bytes.set(r.jpegBytes, offset);
    offset += r.jpegBytes.length;
  }

  return bytes;
}
