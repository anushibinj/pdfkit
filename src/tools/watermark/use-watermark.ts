"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { WatermarkSettings } from "./core/model";
import {
  INITIAL_DOCUMENT_STATUS,
  documentReducer,
  type DocumentStatus,
} from "./document-state";
import type { ApplyResult, PreviewResult } from "./messages";
import { WatermarkEngine } from "./watermark-engine";

/** Everything the watermark page needs from its engine. */
export interface WatermarkTool {
  status: DocumentStatus;
  /** True while the watermarked file is being produced. */
  applying: boolean;
  /** Read and open a PDF the user picked. */
  openFile(file: File): Promise<void>;
  /** Retry opening the pending file with a password. */
  submitPassword(password: string): Promise<void>;
  /** Close the file (or give up on a password) and start over. */
  close(): void;
  /** Render a page as the download will show it (stable identity). */
  preview(
    pageIndex: number,
    width: number,
    settings: WatermarkSettings | undefined,
    signal?: AbortSignal,
  ): Promise<PreviewResult>;
  /** Produce the watermarked file. */
  apply(settings: WatermarkSettings, pages: number[]): Promise<ApplyResult>;
}

/** Result for requests made after the component unmounted. */
const UNMOUNTED = {
  status: "error",
  reason: "failed",
  message: "The watermark tool was closed.",
} as const;

/**
 * Own the watermark engine and the open file's status for the tool page.
 *
 * Opening uses a sequence number (`openSeq`): each attempt takes the next
 * number, and a result is applied only if no newer attempt (or close)
 * happened while it was in flight. Without that, a slow first file could
 * replace a second one the user picked afterwards.
 *
 * @param createEngine Factory for the engine (injected for tests).
 * @returns The status and the actions.
 */
export function useWatermark(
  createEngine: () => WatermarkEngine = () => new WatermarkEngine(),
): WatermarkTool {
  const [status, dispatch] = useReducer(
    documentReducer,
    INITIAL_DOCUMENT_STATUS,
  );
  const [applying, setApplying] = useState(false);
  const engineRef = useRef<WatermarkEngine | null>(null);
  const factoryRef = useRef(createEngine);
  const pendingRef = useRef<{ name: string; data: ArrayBuffer } | null>(null);
  const openSeq = useRef(0);

  useEffect(() => {
    const engine = factoryRef.current();
    engineRef.current = engine;
    return () => {
      // Invalidate anything in flight, then stop the worker. openSeq is a
      // plain counter, not a DOM ref, so reading its latest value is intended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      openSeq.current++;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  /** Open the pending file with `password` and apply the answer. */
  const openPending = useCallback(async (password: string) => {
    const pending = pendingRef.current;
    const engine = engineRef.current;
    if (!pending || !engine) return;
    const seq = ++openSeq.current;
    dispatch({ type: "opening", fileName: pending.name });
    const result = await engine.open(pending.data, password);
    if (seq !== openSeq.current) return;
    if (result.status === "opened") pendingRef.current = null;
    dispatch({ type: "opened", result });
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      let data: ArrayBuffer;
      try {
        data = await file.arrayBuffer();
      } catch (err) {
        dispatch({
          type: "read-failed",
          fileName: file.name,
          message: errorMessage(err),
        });
        return;
      }
      pendingRef.current = { name: file.name, data };
      await openPending("");
    },
    [openPending],
  );

  const submitPassword = useCallback(
    (password: string) => openPending(password),
    [openPending],
  );

  const close = useCallback(() => {
    openSeq.current++;
    pendingRef.current = null;
    void engineRef.current?.close();
    dispatch({ type: "reset" });
  }, []);

  const preview = useCallback(
    (
      pageIndex: number,
      width: number,
      settings: WatermarkSettings | undefined,
      signal?: AbortSignal,
    ): Promise<PreviewResult> =>
      engineRef.current?.preview(pageIndex, width, settings, signal) ??
      Promise.resolve(UNMOUNTED),
    [],
  );

  const apply = useCallback(
    async (
      settings: WatermarkSettings,
      pages: number[],
    ): Promise<ApplyResult> => {
      const engine = engineRef.current;
      if (!engine) return UNMOUNTED;
      setApplying(true);
      try {
        return await engine.apply(settings, pages);
      } catch (err) {
        return {
          status: "error",
          reason: "failed",
          message: errorMessage(err),
        };
      } finally {
        setApplying(false);
      }
    },
    [],
  );

  return {
    status,
    applying,
    openFile,
    submitPassword,
    close,
    preview,
    apply,
  };
}
