"use client";

import type { ConvertResult } from "@/lib/html-pdf/types";
import {
  usePdfConversion,
  type ConversionClient,
  type PdfConversion,
} from "@/lib/html-pdf/use-pdf-conversion";
import { WorkerClient } from "@/lib/worker-client";
import type { HtmlConvertRequest } from "./messages";

/**
 * Create the real worker client. The `new Worker(new URL(...))` expression has
 * to be written out here, in the tool's own code, so the bundler can find the
 * worker file and emit it as a separate chunk. The worker itself only starts
 * on the first request (`WorkerClient` is lazy).
 *
 * @returns A client for a new, lazily started HTML to PDF worker.
 */
export function createWorkerConversionClient(): ConversionClient<HtmlConvertRequest> {
  return new WorkerClient<HtmlConvertRequest, ConvertResult>(
    () =>
      new Worker(new URL("./worker/html2pdf.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/**
 * Run HTML to PDF conversions in a Web Worker and expose their state. All
 * the logic (cancelling, crash recovery, stale results) lives in
 * {@link usePdfConversion}; this hook only selects the HTML worker.
 *
 * @param createClient Factory for the worker client (injected for tests).
 * @returns The current state and the actions.
 */
export function useHtmlConversion(
  createClient: () => ConversionClient<HtmlConvertRequest> = createWorkerConversionClient,
): PdfConversion<HtmlConvertRequest> {
  return usePdfConversion(createClient);
}
