import { describe, expect, it, vi } from "vitest";
import {
  buildSelfHostedTesseractPaths,
  loadSelfHostedTesseractCore,
  TesseractWasmRecognizer,
  type TesseractBaseApi,
  type TesseractCoreModule,
} from "./tesseract-recognizer";

describe("self-hosted Tesseract configuration", () => {
  it("configures workerPath, corePath, langPath under /wasm/ with workerBlobURL: false", () => {
    expect(buildSelfHostedTesseractPaths("https://example.com/wasm")).toEqual({
      workerPath: "https://example.com/wasm/tesseract-worker.min.js",
      corePath: "https://example.com/wasm/",
      langPath: "https://example.com/wasm/",
      workerBlobURL: false,
    });
  });

  it("loads SIMD core when supported and falls back to non-SIMD otherwise", async () => {
    const fakeFactory = vi.fn();
    const importer = vi.fn(async () => ({ default: fakeFactory }));

    const simd = await loadSelfHostedTesseractCore(
      "https://example.com/wasm/",
      importer,
      async () => true,
    );
    expect(simd.wasmFile).toBe(
      "https://example.com/wasm/tesseract-core-simd-lstm.wasm",
    );
    expect(importer).toHaveBeenCalledWith(
      "https://example.com/wasm/tesseract-core-simd-lstm.mjs",
    );

    const nonSimd = await loadSelfHostedTesseractCore(
      "https://example.com/wasm/",
      importer,
      async () => false,
    );
    expect(nonSimd.wasmFile).toBe(
      "https://example.com/wasm/tesseract-core-lstm.wasm",
    );
    expect(importer).toHaveBeenCalledWith(
      "https://example.com/wasm/tesseract-core-lstm.mjs",
    );
  });
});

describe("TesseractWasmRecognizer", () => {
  it("caches traineddata, reuses API for matching language specs, and cleans up VFS", async () => {
    const vfs = new Map<string, Uint8Array | string>();
    const initCalls: string[] = [];
    const endCalls: number[] = [];

    class FakeApi implements TesseractBaseApi {
      Init(_datapath: string | null, lang: string): number {
        initCalls.push(lang);
        return 0;
      }
      SetVariable(): boolean {
        return true;
      }
      SetImageFile(): number {
        return 0;
      }
      Recognize(): number {
        return 0;
      }
      GetUTF8Text(): string {
        return "Hello नमस्ते";
      }
      GetTSVText(): string {
        return "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t95\tHello";
      }
      MeanTextConf(): number {
        return 93;
      }
      End(): void {
        endCalls.push(1);
      }
    }

    class FakePdfRenderer {
      BeginDocument(): boolean {
        return true;
      }
      AddImage(): boolean {
        vfs.set("/tesseract-ocr.pdf", new Uint8Array([37, 80, 68, 70]));
        return true;
      }
      EndDocument(): boolean {
        return true;
      }
    }

    const fakeCore: TesseractCoreModule = {
      FS: {
        writeFile: (p, d) => vfs.set(p, d),
        readFile: (p) => vfs.get(p) as Uint8Array,
        unlink: (p) => {
          vfs.delete(p);
        },
      },
      TessBaseAPI: FakeApi,
      TessPDFRenderer: FakePdfRenderer as unknown as TesseractCoreModule["TessPDFRenderer"],
      _free: vi.fn(),
    };

    const fetchLang = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const gunzip = vi.fn((b: Uint8Array) => b);
    const recognizer = new TesseractWasmRecognizer(
      { gunzip },
      fetchLang,
      async () => fakeCore,
    );

    const out1 = await recognizer.recognizePage(
      new Uint8Array([66, 77]),
      300,
      ["eng", "hin"],
    );
    expect(out1.text).toBe("Hello नमस्ते");
    expect(out1.confidence).toBe(93);
    expect(Array.from(out1.pdfOverlay!)).toEqual([37, 80, 68, 70]);
    expect(fetchLang).toHaveBeenCalledTimes(2);
    expect(initCalls).toEqual(["eng+hin"]);
    expect(vfs.has("/input")).toBe(false);
    expect(vfs.has("/tesseract-ocr.pdf")).toBe(false);

    // Second page with same languages reuses TessBaseAPI and cached traineddata
    await recognizer.recognizePage(new Uint8Array([66, 77]), 300, ["eng", "hin"]);
    expect(fetchLang).toHaveBeenCalledTimes(2);
    expect(initCalls).toEqual(["eng+hin"]);

    // Switching languages ends old API and initializes only once for the new spec
    await recognizer.recognizePage(new Uint8Array([66, 77]), 300, ["eng"]);
    expect(endCalls).toHaveLength(1);
    expect(initCalls).toEqual(["eng+hin", "eng"]);

    recognizer.dispose();
    expect(endCalls).toHaveLength(2);
  });
});
