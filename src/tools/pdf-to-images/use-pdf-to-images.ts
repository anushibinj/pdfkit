"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import { runConversion, type ConversionEngine } from "./conversion-runner";
import {
  INITIAL_DOCUMENT_STATE,
  documentReducer,
  type DocumentState,
} from "./core/document-state";
import type { PageRenderOptions } from "./core/options";
import {
  INITIAL_RUN_STATE,
  runReducer,
  type ConversionMode,
  type RunState,
} from "./core/run-state";
import { ImagesEngine } from "./images-engine";
import type { OpenResult } from "./messages";

/** What the hook needs from `ImagesEngine` (lets tests pass a fake). */
export interface ToolEngine extends ConversionEngine {
  open(data: ArrayBuffer, password?: string): Promise<OpenResult>;
  close(): Promise<void>;
  dispose(): void;
}

export interface PdfToImages {
  document: DocumentState;
  run: RunState;
  /** Open a PDF, replacing the current one and its results. */
  openFile(file: File): Promise<void>;
  /** Try opening the current file with a password. */
  submitPassword(password: string): Promise<void>;
  /** Close the file and forget its results. */
  closeFile(): void;
  /** Convert the given zero-based pages. Ignored while a run is going. */
  convert(
    mode: ConversionMode,
    pages: readonly number[],
    options: PageRenderOptions,
  ): Promise<void>;
  /** Stop the running conversion after the current page. */
  stop(): void;
}

/**
 * State and actions of the PDF to Images tool.
 *
 * Staleness is the tricky part. Opening and converting are asynchronous,
 * and the user can pick another file, close it or unmount the tool at any
 * moment. Each open and each run therefore takes a number from a counter
 * (`openSeq`, `runSeq`); anything that ends the open or the run increments
 * the counter. When an answer arrives, it is applied only if its number is
 * still the current one, so a late answer about a replaced file never
 * shows up. A run also checks the counter (and `stopRef`) before each
 * page, so it ends promptly once it is no longer wanted.
 *
 * @param createEngine Makes the engine (injected for tests).
 * @returns The state and the actions.
 */
export function usePdfToImages(
  createEngine: () => ToolEngine = () => new ImagesEngine(),
): PdfToImages {
  const [document, dispatchDocument] = useReducer(
    documentReducer,
    INITIAL_DOCUMENT_STATE,
  );
  const [run, dispatchRun] = useReducer(runReducer, INITIAL_RUN_STATE);
  const engineRef = useRef<ToolEngine | null>(null);
  const factoryRef = useRef(createEngine);
  const fileRef = useRef<{ name: string; data: ArrayBuffer } | null>(null);
  const openSeq = useRef(0);
  const runSeq = useRef(0);
  const stopRef = useRef(false);
  const runningRef = useRef(false);

  useEffect(() => {
    const engine = factoryRef.current();
    engineRef.current = engine;
    return () => {
      // Invalidate everything in flight; the counters are plain numbers,
      // so reading their latest value here is intended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      openSeq.current++;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runSeq.current++;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  /** End any run: its late progress is ignored and it stops at its next page. */
  const abandonRun = useCallback(() => {
    runSeq.current++;
    stopRef.current = true;
    runningRef.current = false;
    dispatchRun({ type: "reset" });
  }, []);

  const openWith = useCallback(async (password: string) => {
    const engine = engineRef.current;
    const file = fileRef.current;
    if (!engine || !file) return;
    const seq = ++openSeq.current;
    dispatchDocument({ type: "opening", fileName: file.name });
    const result = await engine.open(file.data, password);
    if (seq === openSeq.current) dispatchDocument({ type: "opened", result });
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      abandonRun();
      const seq = ++openSeq.current;
      fileRef.current = null;
      dispatchDocument({ type: "opening", fileName: file.name });
      let data: ArrayBuffer;
      try {
        data = await file.arrayBuffer();
      } catch (err) {
        if (seq === openSeq.current) {
          dispatchDocument({
            type: "read-failed",
            fileName: file.name,
            message: `Could not read the file: ${errorMessage(err)}`,
          });
        }
        return;
      }
      if (seq !== openSeq.current) return;
      fileRef.current = { name: file.name, data };
      await openWith("");
    },
    [abandonRun, openWith],
  );

  const submitPassword = useCallback(
    (password: string) => openWith(password),
    [openWith],
  );

  const closeFile = useCallback(() => {
    abandonRun();
    openSeq.current++;
    fileRef.current = null;
    void engineRef.current?.close();
    dispatchDocument({ type: "reset" });
  }, [abandonRun]);

  const convert = useCallback(
    async (
      mode: ConversionMode,
      pages: readonly number[],
      options: PageRenderOptions,
    ) => {
      const engine = engineRef.current;
      if (!engine || runningRef.current || pages.length === 0) return;
      runningRef.current = true;
      stopRef.current = false;
      const seq = ++runSeq.current;
      const current = () => seq === runSeq.current;
      dispatchRun({ type: "start", mode, total: pages.length });
      let outcome: Awaited<ReturnType<typeof runConversion>>;
      try {
        outcome = await runConversion(engine, mode, pages, options, {
          onPage: (file) => {
            if (current()) dispatchRun({ type: "page-rendered", file });
          },
          onImages: (findings) => {
            if (current()) dispatchRun({ type: "images-found", findings });
          },
          shouldStop: () => stopRef.current || !current(),
        });
      } catch (err) {
        outcome = { ok: false, message: errorMessage(err) };
      }
      if (!current()) return;
      runningRef.current = false;
      dispatchRun(
        outcome.ok
          ? { type: "finish" }
          : { type: "fail", message: outcome.message },
      );
    },
    [],
  );

  const stop = useCallback(() => {
    if (!runningRef.current) return;
    stopRef.current = true;
    dispatchRun({ type: "stop-requested" });
  }, []);

  return {
    document,
    run,
    openFile,
    submitPassword,
    closeFile,
    convert,
    stop,
  };
}
