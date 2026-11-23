/**
 * Core domain types and data contracts for the Compress PDF tool.
 *
 * Follows Single Responsibility Principle (SRP) and Interface Segregation
 * Principle (ISP) by keeping pure data models decoupled from WebAssembly
 * execution, worker messaging, and React UI components.
 */

/** Available compression modes and presets matching Issue #20. */
export type CompressPreset =
  | "lossless"
  | "balanced"
  | "small"
  | "custom"
  | "target-size";

/** User-configured options controlling PDF compression behaviour. */
export interface CompressOptions {
  /** Selected preset or mode (`lossless`, `balanced`, `small`, `custom`, `target-size`). */
  preset: CompressPreset;
  /** Target maximum image DPI used in `custom` mode (36–600). */
  dpi: number;
  /** Target JPEG encoding quality in `custom` mode (0.1–1.0). */
  quality: number;
  /** Whether to convert opaque embedded images to grayscale (available in `custom` / `target-size`). */
  grayscale: boolean;
  /** Target maximum output file size in megabytes for `target-size` mode (e.g. `2` for 2 MB). */
  targetSizeMb: number;
}

/** Concrete single-pass engine configuration resolved from {@link CompressOptions}. */
export interface ResolvedPassConfig {
  /** When true, only structural/lossless passes run; document appearance is untouched. */
  lossless: boolean;
  /** Target image DPI ceiling (`0` disables downsampling). */
  targetDpi: number;
  /** JPEG quality in `[0.1, 1.0]`. */
  quality: number;
  /** Whether eligible opaque images are converted to 1-channel DeviceGray JPEG. */
  grayscale: boolean;
}

/**
 * Pre-encoded JPEG replacement for a specific embedded image stream,
 * keyed by the FNV-1a 64-bit hash of the original PDF stream bytes.
 */
export interface ImageReplacementEntry {
  /** 64-bit unsigned FNV-1a hash of the original raw image stream bytes. */
  rawHash: bigint;
  /** Original image width in pixels. */
  originalWidth: number;
  /** Original image height in pixels. */
  originalHeight: number;
  /** Replacement JPEG width in pixels. */
  newWidth: number;
  /** Replacement JPEG height in pixels. */
  newHeight: number;
  /** Whether the replacement JPEG is grayscale (`DeviceGray`). */
  grayscale: boolean;
  /** Encoded JPEG bytes (`/DCTDecode` stream payload). */
  jpegBytes: Uint8Array;
}

/** Detailed telemetry report returned by the compression engine. */
export interface CompressReport {
  /** Original input file size in bytes. */
  originalBytes: number;
  /** Compressed output file size in bytes. */
  compressedBytes: number;
  /** Total Image XObjects inspected. */
  imagesInspected: number;
  /** Opaque images re-encoded into smaller JPEG streams. */
  imagesReencoded: number;
  /** Images downsampled to fit the target DPI ceiling. */
  imagesDownsampled: number;
  /** Duplicate streams collapsed into a single shared object. */
  imagesDeduplicated: number;
  /** Images kept intact because re-encoding did not reduce byte size. */
  imagesSkippedLarger: number;
  /** `/FlateDecode` streams shrunk with level-9 zlib compression. */
  flateStreamsRecompressed: number;
  /** Unreferenced PDF objects pruned. */
  objectsRemoved: number;
  /** Soft-mask/alpha images preserved losslessly. */
  transparencyPreserved: number;
  /** Additional human-readable notes emitted by the engine. */
  notes: string[];
}

/** Evaluation metadata when running in `"target-size"` ("make it under X MB") mode. */
export interface TargetSizeEvaluation {
  /** Requested upper size bound in bytes. */
  targetBytes: number;
  /** Whether the compressed output is strictly `<= targetBytes`. */
  targetMet: boolean;
  /** Number of quality/DPI steps evaluated. */
  attempts: number;
  /** The configuration that produced the returned PDF. */
  appliedConfig: ResolvedPassConfig;
  /** Clear explanation when the target size could not be reached safely. */
  explanation?: string;
}

/** High-level result of compressing one PDF document. */
export type CompressOutcome =
  | {
      kind: "compressed";
      /** Compressed PDF bytes. */
      pdf: Uint8Array;
      /** Total page count verified by PDFium. */
      pageCount: number;
      /** Original input size in bytes. */
      originalBytes: number;
      /** Final compressed size in bytes. */
      compressedBytes: number;
      /** Telemetry breakdown of optimizations applied. */
      report: CompressReport;
      /** Concrete pass configuration applied. */
      appliedConfig: ResolvedPassConfig;
      /** Target-size evaluation details when `preset === "target-size"`. */
      targetEvaluation?: TargetSizeEvaluation;
      /** Non-fatal warnings from qpdf/PDFium. */
      warnings?: string;
    }
  | {
      kind: "password-required";
      /** True when a previously submitted password failed to decrypt the file. */
      wrongPassword?: boolean;
    }
  | {
      kind: "failed";
      /** Human-readable error message. */
      message: string;
    };
