/// <reference lib="webworker" />
/**
 * Web Worker entry point for PDF repair operations.
 *
 * Implements Dependency Inversion Principle (DIP) and Single Responsibility Principle (SRP)
 * as the composition root: wires together low-level WebAssembly engines, PDFium runtime,
 * and high-level repair session without embedding procedural repair logic.
 */

import { loadPdfium } from "@/lib/pdfium/load-pdfium";
import { retryableOnce } from "@/lib/retryable-once";
import { exposeWorker } from "@/lib/worker-protocol";
import { PdfRepairModule } from "../engine/repair-pdf-module";
import { RepairSession } from "../engine/repair-session";
import { RepairVerifier } from "../engine/repair-verifier";
import type { RepairRequest, RepairWorkerResult } from "../messages";
import { fetchBytes } from "./fetch-bytes";
import { createRepairHandler } from "./repair-handler";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const WASM_DIR = `${scope.location.origin}/wasm/`;

/** Lazy singleton for the byte-carving WebAssembly engine (`crates/pdf-repair`). */
const repairModule = retryableOnce(() =>
  PdfRepairModule.load(`${WASM_DIR}pdf-repair.wasm`, (url) => fetchBytes(url)),
);

/** Lazy singleton for PDFium validation and normalization engine. */
const verifier = retryableOnce(async () => {
  const pdfiumCoreApi = await loadPdfium(
    WASM_DIR,
    (url) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url),
  );
  return new RepairVerifier(pdfiumCoreApi);
});

/** Lazy singleton for high-level RepairSession orchestrating both engines. */
const session = retryableOnce(async () => {
  const [mod, ver] = await Promise.all([
    repairModule.get(),
    verifier.get(),
  ]);
  return new RepairSession(mod, ver);
});

exposeWorker<RepairRequest, RepairWorkerResult>(
  scope,
  createRepairHandler(() => session.get()),
);
