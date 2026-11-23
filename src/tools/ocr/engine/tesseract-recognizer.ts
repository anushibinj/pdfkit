/**
 * Self-hosted Tesseract WebAssembly recognizer.
 *
 * Follows Single Responsibility Principle (SRP) and Dependency Inversion Principle (DIP):
 * implements {@link OcrRecognizer} using `tesseract.js-core` compiled to WebAssembly,
 * loading `.traineddata.gz` language files exclusively from same-origin `/wasm/`
 * (strict CSP: `default-src 'self'`, no CDN, no blob worker URLs).
 */

import { formatLanguageCodes } from "../core/languages";
import type { OcrLanguageCode } from "../core/model";
import type { OcrHelperModule } from "./pdf-ocr-module";

/** Recognized text, confidence, TSV word boxes, and optional glyphless PDF overlay for one page. */
export interface RecognizedPageOutput {
  /** UTF-8 plain text recognized on the page. */
  text: string;
  /** Tesseract TSV word-box output (for fallback text-layer generation). */
  tsv: string;
  /** Mean character confidence (`0..100`). */
  confidence: number;
  /** Text-only PDF produced by `TessPDFRenderer` (glyphless font), or `null` if unavailable. */
  pdfOverlay: Uint8Array | null;
}

/**
 * Abstraction for OCR recognition (Dependency Inversion Principle).
 * Enables testing {@link OcrSession} with lightweight deterministic fakes.
 */
export interface OcrRecognizer {
  recognizePage(
    bmpBytes: Uint8Array,
    dpi: number,
    languages: readonly OcrLanguageCode[],
    onProgress?: (fraction: number) => void,
  ): Promise<RecognizedPageOutput>;
}

/** Minimal Emscripten `TesseractCore` module surface used by {@link TesseractWasmRecognizer}. */
export interface TesseractCoreModule {
  FS: {
    writeFile(path: string, data: Uint8Array | string): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
  TessBaseAPI: new () => TesseractBaseApi;
  TessPDFRenderer: new (
    outputbase: string,
    datadir: string,
    textonly: boolean,
  ) => TesseractPdfRenderer;
  _free(ptr: number): void;
}

/** Minimal `TessBaseAPI` C++ binding surface. */
export interface TesseractBaseApi {
  Init(
    datapath: string | null,
    language: string,
    oem: number,
    configFile?: string,
  ): number;
  SetVariable(name: string, value: string): boolean;
  SetImageFile(exif: number, angle: number): number;
  Recognize(monitor: unknown): number;
  GetUTF8Text(): string;
  GetTSVText(pageNumber?: number): string;
  MeanTextConf(): number;
  End(): void;
}

/** Minimal `TessPDFRenderer` C++ binding surface. */
export interface TesseractPdfRenderer {
  BeginDocument(title: string): boolean;
  AddImage(api: TesseractBaseApi): boolean;
  EndDocument(): boolean;
}

/** Factory creating a {@link TesseractCoreModule} given Emscripten `Module` callbacks. */
export type TesseractCoreFactory = (moduleArg: {
  locateFile?: (path: string) => string;
  TesseractProgress?: (percent: number) => void;
}) => Promise<TesseractCoreModule>;

/** Self-hosted `/wasm/` paths required by strict CSP (`default-src 'self'`). */
export interface SelfHostedTesseractPaths {
  workerPath: string;
  corePath: string;
  langPath: string;
  workerBlobURL: false;
}

/**
 * Returns the self-hosted Tesseract configuration paths under `wasmDir` so
 * `tesseract.js` / `tesseract.js-core` never contact external CDNs or create
 * `blob:` worker URLs blocked by CSP.
 *
 * @param wasmDir Origin-qualified `/wasm/` directory URL ending with `"/"`.
 * @returns {@link SelfHostedTesseractPaths}.
 */
export function buildSelfHostedTesseractPaths(
  wasmDir: string,
): SelfHostedTesseractPaths {
  const normalized = wasmDir.endsWith("/") ? wasmDir : `${wasmDir}/`;
  return {
    workerPath: `${normalized}tesseract-worker.min.js`,
    corePath: normalized,
    langPath: normalized,
    workerBlobURL: false,
  };
}

/**
 * Loads `TesseractCore` from `/wasm/`, prefers the SIMD LSTM build and falls
 * back to standard LSTM when WebAssembly SIMD is unavailable.
 *
 * @param wasmDir Absolute `/wasm/` URL ending with `"/"`.
 * @param importer Dynamic ES module importer (`(url) => import(url)`).
 * @param supportsSimd Optional override for SIMD feature detection (tested in unit tests).
 * @returns Ready {@link TesseractCoreFactory}.
 */
export async function loadSelfHostedTesseractCore(
  wasmDir: string,
  importer: (url: string) => Promise<unknown>,
  supportsSimd?: () => Promise<boolean>,
): Promise<{ factory: TesseractCoreFactory; wasmFile: string }> {
  const normalized = wasmDir.endsWith("/") ? wasmDir : `${wasmDir}/`;
  const hasSimd = supportsSimd
    ? await supportsSimd()
    : detectWasmSimdSupport();
  const baseName = hasSimd ? "tesseract-core-simd-lstm" : "tesseract-core-lstm";
  const mod = (await importer(`${normalized}${baseName}.mjs`)) as {
    default?: TesseractCoreFactory;
  };
  if (typeof mod.default !== "function") {
    throw new Error(`Failed to load ${baseName}.mjs from ${normalized}`);
  }
  return {
    factory: mod.default,
    wasmFile: `${normalized}${baseName}.wasm`,
  };
}

/**
 * Minimal WebAssembly SIMD probe using the standard 4-line v128 module bytes.
 * Avoids extra runtime network requests.
 */
export function detectWasmSimdSupport(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
        0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00,
        0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b,
      ]),
    );
  } catch {
    return false;
  }
}

/**
 * Self-hosted Tesseract WebAssembly recognizer running inside the OCR worker.
 *
 * Caches loaded `.traineddata` files in the Emscripten virtual filesystem and
 * reuses the active `TessBaseAPI` instance across pages whenever the selected
 * language combination has not changed.
 */
export class TesseractWasmRecognizer implements OcrRecognizer {
  private core: TesseractCoreModule | null = null;
  private api: TesseractBaseApi | null = null;
  private activeLangSpec: string | null = null;
  private readonly loadedLangs = new Set<string>();
  private progressHandler: ((fraction: number) => void) | null = null;

  /**
   * @param helper {@link OcrHelperModule} used for gunzip decompression.
   * @param fetchLanguageBytes Function fetching `<lang>.traineddata.gz` bytes.
   * @param instantiateCore Async factory initializing {@link TesseractCoreModule}.
   */
  constructor(
    private readonly helper: Pick<OcrHelperModule, "gunzip">,
    private readonly fetchLanguageBytes: (
      lang: OcrLanguageCode,
    ) => Promise<Uint8Array>,
    private readonly instantiateCore: (
      onProgress: (percent: number) => void,
    ) => Promise<TesseractCoreModule>,
  ) {}

  /**
   * Recognizes a single DPI-tagged BMP page image using the requested languages.
   *
   * @param bmpBytes Complete 24-bit BMP bytes.
   * @param dpi Effective page DPI.
   * @param languages Selected OCR language codes.
   * @param onProgress Optional recognition progress callback (`0..1`).
   * @returns Plain text, TSV word boxes, mean confidence, and optional `pdfTextOnly` PDF.
   */
  async recognizePage(
    bmpBytes: Uint8Array,
    dpi: number,
    languages: readonly OcrLanguageCode[],
    onProgress?: (fraction: number) => void,
  ): Promise<RecognizedPageOutput> {
    const core = await this.ensureCore();
    const langSpec = formatLanguageCodes(languages);

    await this.ensureLanguagesLoaded(core, languages);
    this.ensureApiInitialized(core, langSpec);

    const api = this.api!;
    this.progressHandler = onProgress ?? null;

    try {
      core.FS.writeFile("/input", bmpBytes);
      const imgStatus = api.SetImageFile(1, 0);
      if (imgStatus === 1) {
        throw new Error("Tesseract could not decode the rendered page image.");
      }

      api.SetVariable("user_defined_dpi", String(Math.max(72, Math.round(dpi))));
      api.Recognize(null);

      const text = (api.GetUTF8Text() ?? "").trim();
      const tsv = api.GetTSVText(0) ?? "";
      const confidence = Math.max(0, Math.min(100, api.MeanTextConf() ?? 0));

      let pdfOverlay: Uint8Array | null = null;
      try {
        // Generate Tesseract's native text-only PDF using its built-in `/pdf.ttf`
        // glyphless font so Unicode copy/search works out of the box across Indic scripts.
        const renderer = new core.TessPDFRenderer("tesseract-ocr", "/", true);
        try {
          renderer.BeginDocument("PDFKit OCR");
          renderer.AddImage(api);
          renderer.EndDocument();
        } finally {
          core._free(renderer as unknown as number);
        }
        pdfOverlay = core.FS.readFile("/tesseract-ocr.pdf").slice();
      } catch {
        // Fallback to Rust `buildTextLayer` in OcrSession if TessPDFRenderer fails.
        pdfOverlay = null;
      } finally {
        safeUnlink(core, "/tesseract-ocr.pdf");
        safeUnlink(core, "/input");
      }

      return { text, tsv, confidence, pdfOverlay };
    } finally {
      this.progressHandler = null;
    }
  }

  /** Releases the active `TessBaseAPI` instance. */
  dispose(): void {
    if (this.api) {
      this.api.End();
      this.api = null;
      this.activeLangSpec = null;
    }
  }

  /** Lazily instantiates the Tesseract Emscripten core once per worker. */
  private async ensureCore(): Promise<TesseractCoreModule> {
    if (this.core) return this.core;
    this.core = await this.instantiateCore((percent) => {
      if (this.progressHandler) {
        // TesseractProgress reports 30..100 during recognition
        const normalized = Math.max(0, Math.min(1, (percent - 30) / 70));
        this.progressHandler(normalized);
      }
    });
    return this.core;
  }

  /** Fetches, gunzips via Rust WASM, and writes any missing `.traineddata` files to VFS. */
  private async ensureLanguagesLoaded(
    core: TesseractCoreModule,
    languages: readonly OcrLanguageCode[],
  ): Promise<void> {
    const needed = languages.filter((lang) => !this.loadedLangs.has(lang));
    if (needed.length === 0) return;

    await Promise.all(
      needed.map(async (lang) => {
        const compressed = await this.fetchLanguageBytes(lang);
        const traineddata = this.helper.gunzip(compressed);
        core.FS.writeFile(`/${lang}.traineddata`, traineddata);
        this.loadedLangs.add(lang);
      }),
    );
  }

  /** Initializes or re-initializes `TessBaseAPI` with OEM LSTM_ONLY (1) when languages change. */
  private ensureApiInitialized(
    core: TesseractCoreModule,
    langSpec: string,
  ): void {
    if (this.api && this.activeLangSpec === langSpec) return;

    if (this.api) {
      this.api.End();
      this.api = null;
    }

    const nextApi = new core.TessBaseAPI();
    // OEM = 1 (LSTM_ONLY) matches our `tesseract-core-*-lstm` + `tessdata_fast` build.
    const status = nextApi.Init(null, langSpec, 1);
    if (status === -1) {
      nextApi.End();
      throw new Error(
        `Could not initialize Tesseract OCR for language(s): ${langSpec}.`,
      );
    }
    this.api = nextApi;
    this.activeLangSpec = langSpec;
  }
}

/** Removes a temporary file from Emscripten VFS without throwing if absent. */
function safeUnlink(core: TesseractCoreModule, filePath: string): void {
  try {
    core.FS.unlink(filePath);
  } catch {
    // Ignore missing VFS file
  }
}
