"use client";

/**
 * Custom React hook coordinating batch PDF compression, password unlocking,
 * side-by-side preview rendering, and Web Worker lifecycle management.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Coordinates async worker calls and sequence-safe state dispatch.
 * - Dependency Inversion: Permits injection of a custom `createClient` factory for testing.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import {
  createWorkerCompressClient,
  type CompressClient,
} from "./compress-client";
import {
  compressReducer,
  INITIAL_COMPRESS_STATE,
  type CompressFileItem,
  type CompressState,
} from "./compress-state";
import type { CompressOptions } from "./core/model";

/** Public controller surface returned by {@link useCompressPdf}. */
export interface UseCompressPdfReturn {
  state: CompressState;
  addFiles(files: File[]): void;
  removeFile(id: string): void;
  setOptions(options: CompressOptions): void;
  compressAll(): Promise<void>;
  submitPassword(id: string, password: string): Promise<void>;
  dismissPassword(id: string): void;
  reopenPassword(id: string): void;
  openPreview(itemId: string, pageIndex?: number, width?: number): Promise<void>;
  closePreview(): void;
  cancel(): void;
  clear(): void;
}

/**
 * Generates unique client-side item IDs for batch rows.
 */
function nextItemId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Orchestrates batch PDF compression and visual side-by-side preview rendering
 * inside a dedicated Web Worker.
 *
 * @param createClient Optional client factory injected in unit tests.
 * @returns State and imperative action handlers.
 */
export function useCompressPdf(
  createClient: () => CompressClient = createWorkerCompressClient,
): UseCompressPdfReturn {
  const [state, dispatch] = useReducer(compressReducer, INITIAL_COMPRESS_STATE);
  const clientRef = useRef<CompressClient | null>(null);
  const seqRef = useRef(0);
  const previewSeqRef = useRef(0);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const restartClient = useCallback((): CompressClient => {
    clientRef.current?.terminate();
    const next = createClient();
    clientRef.current = next;
    return next;
  }, [createClient]);

  useEffect(() => {
    clientRef.current = createClient();
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seqRef.current++;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      previewSeqRef.current++;
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, [createClient]);

  /**
   * Compresses a single file item against the active worker client.
   */
  const runOneItem = useCallback(
    async (
      item: CompressFileItem,
      options: CompressOptions,
      password: string | undefined,
      seq: number,
    ): Promise<void> => {
      if (seqRef.current !== seq) return;
      dispatch({ type: "start-item", id: item.id });

      try {
        const buffer = await item.file.arrayBuffer();
        if (seqRef.current !== seq) return;

        const client = clientRef.current ?? restartClient();
        const result = await client.compress(
          buffer,
          item.file.name,
          options,
          password,
          (progress, stage) => {
            if (seqRef.current === seq) {
              dispatch({ type: "item-progress", id: item.id, progress, stage });
            }
          },
        );

        if (seqRef.current !== seq) return;

        switch (result.status) {
          case "compressed": {
            const pdf = new Blob([result.data], { type: "application/pdf" });
            dispatch({
              type: "item-compressed",
              id: item.id,
              pdf,
              pageCount: result.pageCount,
              originalBytes: result.originalBytes,
              compressedBytes: result.compressedBytes,
              report: result.report,
              appliedConfig: result.appliedConfig,
              targetEvaluation: result.targetEvaluation,
              warnings: result.warnings,
            });
            break;
          }
          case "password-required":
            dispatch({
              type: "item-password-required",
              id: item.id,
              wrongPassword: result.wrongPassword,
            });
            break;
          case "error":
            dispatch({
              type: "item-error",
              id: item.id,
              message: result.message,
            });
            break;
        }
      } catch (err: unknown) {
        if (seqRef.current === seq) {
          dispatch({
            type: "item-error",
            id: item.id,
            message: errorMessage(err) || "Failed to compress this PDF.",
          });
        }
      }
    },
    [restartClient],
  );

  /**
   * Adds one or more PDF files to the compression queue.
   *
   * @param files Files dropped or chosen by the user.
   */
  const addFiles = useCallback((files: File[]): void => {
    if (files.length === 0) return;
    dispatch({
      type: "add-files",
      entries: files.map((file) => ({ id: nextItemId(), file })),
    });
  }, []);

  /**
   * Removes an item from the queue.
   *
   * @param id Item identifier.
   */
  const removeFile = useCallback((id: string): void => {
    dispatch({ type: "remove-file", id });
  }, []);

  /**
   * Updates compression options (clearing outdated compressed outputs).
   *
   * @param options Next {@link CompressOptions}.
   */
  const setOptions = useCallback((options: CompressOptions): void => {
    dispatch({ type: "set-options", options });
  }, []);

  /**
   * Compresses all queued items that are `"ready"` or `"error"`.
   */
  const compressAll = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    const targets = current.items.filter(
      (i) => i.status.kind === "ready" || i.status.kind === "error",
    );
    if (targets.length === 0) return;

    const seq = ++seqRef.current;
    const options = current.options;
    dispatch({ type: "start-batch" });

    for (const item of targets) {
      if (seqRef.current !== seq) return;
      await runOneItem(item, options, item.password, seq);
    }

    if (seqRef.current === seq) {
      dispatch({ type: "finish-batch" });
    }
  }, [runOneItem]);

  /**
   * Submits an open password for a locked item and immediately compresses it.
   *
   * @param id Item identifier.
   * @param password Password typed by the user.
   */
  const submitPassword = useCallback(
    async (id: string, password: string): Promise<void> => {
      const target = stateRef.current.items.find((i) => i.id === id);
      if (!target) return;

      dispatch({ type: "submit-password", id, password });
      const seq = ++seqRef.current;
      dispatch({ type: "start-batch" });
      await runOneItem(target, stateRef.current.options, password, seq);
      if (seqRef.current === seq) {
        dispatch({ type: "finish-batch" });
      }
    },
    [runOneItem],
  );

  /** Dismisses the password modal for a file without removing it. */
  const dismissPassword = useCallback((id: string): void => {
    dispatch({ type: "dismiss-password", id });
  }, []);

  /** Reopens the password modal for a dismissed file. */
  const reopenPassword = useCallback((id: string): void => {
    dispatch({ type: "reopen-password", id });
  }, []);

  /**
   * Requests a side-by-side original vs compressed page render for a compressed item.
   *
   * @param itemId Identifier of the compressed item.
   * @param pageIndex Zero-based page index (defaults to 0).
   * @param width Target canvas width in device pixels (defaults to 640).
   */
  const openPreview = useCallback(
    async (itemId: string, pageIndex = 0, width = 640): Promise<void> => {
      const item = stateRef.current.items.find((i) => i.id === itemId);
      if (!item || item.status.kind !== "compressed") return;

      const compressedBlob = item.status.pdf;
      const pageCount = item.status.pageCount;
      const clampedPage = Math.max(0, Math.min(pageCount - 1, pageIndex));
      const pSeq = ++previewSeqRef.current;

      dispatch({
        type: "open-preview",
        itemId,
        pageIndex: clampedPage,
        pageCount,
      });

      try {
        const [origBuf, compBuf] = await Promise.all([
          item.file.arrayBuffer(),
          compressedBlob.arrayBuffer(),
        ]);
        if (previewSeqRef.current !== pSeq) return;

        const client = clientRef.current ?? restartClient();
        const res = await client.renderPreview(
          origBuf,
          compBuf,
          clampedPage,
          width,
          item.password,
        );
        if (previewSeqRef.current !== pSeq) return;

        if (res.status === "preview-rendered") {
          dispatch({
            type: "preview-loaded",
            itemId,
            pageIndex: res.pageIndex,
            pageCount: res.pageCount,
            width: res.width,
            height: res.height,
            originalPixels: new Uint8Array(res.originalPixels),
            compressedPixels: new Uint8Array(res.compressedPixels),
          });
        } else if (res.status === "error") {
          dispatch({
            type: "preview-error",
            itemId,
            message: res.message,
          });
        }
      } catch (err: unknown) {
        if (previewSeqRef.current === pSeq) {
          dispatch({
            type: "preview-error",
            itemId,
            message: errorMessage(err) || "Could not render page preview.",
          });
        }
      }
    },
    [restartClient],
  );

  /** Closes the side-by-side preview panel. */
  const closePreview = useCallback((): void => {
    previewSeqRef.current++;
    dispatch({ type: "close-preview" });
  }, []);

  /** Cancels any active compression job and restarts the Web Worker. */
  const cancel = useCallback((): void => {
    seqRef.current++;
    restartClient();
    dispatch({ type: "cancel-batch" });
  }, [restartClient]);

  /** Clears all files and resets the tool to initial state. */
  const clear = useCallback((): void => {
    seqRef.current++;
    previewSeqRef.current++;
    restartClient();
    dispatch({ type: "clear" });
  }, [restartClient]);

  return {
    state,
    addFiles,
    removeFile,
    setOptions,
    compressAll,
    submitPassword,
    dismissPassword,
    reopenPassword,
    openPreview,
    closePreview,
    cancel,
    clear,
  };
}
