"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import {
  INITIAL_DOCUMENT_STATUS,
  documentReducer,
  type DocumentStatus,
} from "./document-state";
import type { RenderResult } from "./messages";
import { PreviewEngine } from "./preview-engine";

/** The opened file, as the assembly worker needs it. */
export interface DocumentSource {
  data: ArrayBuffer;
  password: string;
}

/** Everything the tool needs to know and do about the opened PDF. */
export interface SplitDocument {
  status: DocumentStatus;
  /** Read and open a PDF the user picked. */
  openFile(file: File): Promise<void>;
  /** Retry opening the pending file with a password. */
  submitPassword(password: string): Promise<void>;
  /** Close the file (or give up on a password) and start over. */
  close(): void;
  /** Draw a page as a thumbnail (stable identity across renders). */
  renderPage(
    pageIndex: number,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderResult>;
  /** The opened file's bytes and password, or null until one is ready. */
  getSource(): DocumentSource | null;
}

/** Result for requests made after the component unmounted. */
const UNMOUNTED = {
  status: "error",
  reason: "failed",
  message: "The tool was closed.",
} as const;

/**
 * Own the preview engine and the opened file for the tool page.
 *
 * Opening uses a sequence number (`openSeq`): each attempt takes the next
 * number, and a result is applied only if no newer attempt (or close)
 * happened while it was in flight. Without that, a slow first file could
 * replace a second one the user picked afterwards.
 *
 * The file's bytes are read once and kept here: the preview engine keeps
 * them for re-opening after a crash, and the assembly worker gets a copy
 * each time files are made.
 *
 * @param createEngine Factory for the engine (injected for tests).
 * @returns The document's state and actions.
 */
export function useSplitDocument(
  createEngine: () => PreviewEngine = () => new PreviewEngine(),
): SplitDocument {
  const [status, dispatch] = useReducer(documentReducer, INITIAL_DOCUMENT_STATUS);
  const engineRef = useRef<PreviewEngine | null>(null);
  const factoryRef = useRef(createEngine);
  const pendingRef = useRef<{ name: string; size: number; data: ArrayBuffer } | null>(
    null,
  );
  const sourceRef = useRef<DocumentSource | null>(null);
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
    // The status stops showing the previous file here, so its source goes
    // now too: status and source always describe the same file.
    sourceRef.current = null;
    dispatch({
      type: "opening",
      fileName: pending.name,
      fileSize: pending.size,
      withPassword: password !== "",
    });
    const result = await engine.open(pending.data, password);
    if (seq !== openSeq.current) return;
    if (result.status === "opened") {
      sourceRef.current = { data: pending.data, password };
      pendingRef.current = null;
    }
    dispatch({ type: "opened", result });
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      // While the new file is read, the previous one (if any) stays open
      // and usable: nothing changes until reading succeeds or fails.
      let data: ArrayBuffer;
      try {
        data = await file.arrayBuffer();
      } catch (err) {
        // The status moves to "failed", so the previous file is closed,
        // here and in the worker, instead of staying in memory unseen.
        openSeq.current++;
        pendingRef.current = null;
        sourceRef.current = null;
        void engineRef.current?.close();
        dispatch({ type: "read-failed", fileName: file.name, message: errorMessage(err) });
        return;
      }
      pendingRef.current = { name: file.name, size: file.size, data };
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
    sourceRef.current = null;
    void engineRef.current?.close();
    dispatch({ type: "reset" });
  }, []);

  const renderPage = useCallback(
    (pageIndex: number, width: number, signal?: AbortSignal): Promise<RenderResult> =>
      engineRef.current?.render(pageIndex, width, signal) ?? Promise.resolve(UNMOUNTED),
    [],
  );

  const getSource = useCallback(() => sourceRef.current, []);

  return { status, openFile, submitPassword, close, renderPage, getSource };
}
