"use client";

/**
 * Custom React hook coordinating batch OCR processing, password unlocking,
 * text inspection, cancellation, and Web Worker lifecycle management.
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Coordinates async worker calls and sequence-safe state dispatch.
 * - Dependency Inversion: Accepts an injectable `createClient` factory for testing.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import type { OcrOptions } from "./core/model";
import { createWorkerOcrClient, type OcrClient } from "./ocr-client";
import {
  INITIAL_OCR_STATE,
  ocrReducer,
  type OcrFileItem,
  type OcrState,
} from "./ocr-state";

/** Public controller surface returned by {@link useOcrPdf}. */
export interface UseOcrPdfReturn {
  state: OcrState;
  addFiles(files: File[]): void;
  removeFile(id: string): void;
  setOptions(options: OcrOptions): void;
  runAll(): Promise<void>;
  submitPassword(id: string, password: string): Promise<void>;
  dismissPassword(id: string): void;
  reopenPassword(id: string): void;
  inspectText(itemId: string | null): void;
  cancel(): void;
  clear(): void;
}

/** Generates unique client-side IDs for queued file rows. */
function nextItemId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Orchestrates batch OCR recognition inside a dedicated Web Worker.
 *
 * @param createClient Optional client factory injected in unit tests.
 * @returns State and imperative action handlers.
 */
export function useOcrPdf(
  createClient: () => OcrClient = createWorkerOcrClient,
): UseOcrPdfReturn {
  const [state, dispatch] = useReducer(ocrReducer, INITIAL_OCR_STATE);
  const clientRef = useRef<OcrClient | null>(null);
  const seqRef = useRef(0);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const restartClient = useCallback((): OcrClient => {
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
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, [createClient]);

  /**
   * Runs OCR on a single file item against the active worker client.
   */
  const runOneItem = useCallback(
    async (
      item: OcrFileItem,
      options: OcrOptions,
      password: string | undefined,
      seq: number,
    ): Promise<void> => {
      if (seqRef.current !== seq) return;
      dispatch({ type: "start-item", id: item.id });

      try {
        const buffer = await item.file.arrayBuffer();
        if (seqRef.current !== seq) return;

        const client = clientRef.current ?? restartClient();
        const result = await client.runOcr(
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
          case "completed": {
            const pdf = new Blob([result.data], { type: "application/pdf" });
            dispatch({
              type: "item-completed",
              id: item.id,
              pdf,
              report: result.report,
              wasImageInput: result.wasImageInput,
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
          case "cancelled":
            dispatch({ type: "cancel-batch" });
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
            message: errorMessage(err) || "Failed to run OCR on this file.",
          });
        }
      }
    },
    [restartClient],
  );

  /** Adds dropped or chosen PDF/image files to the OCR queue. */
  const addFiles = useCallback((files: File[]): void => {
    if (files.length === 0) return;
    dispatch({
      type: "add-files",
      entries: files.map((file) => ({ id: nextItemId(), file })),
    });
  }, []);

  /** Removes a queued item by ID. */
  const removeFile = useCallback((id: string): void => {
    dispatch({ type: "remove-file", id });
  }, []);

  /** Updates OCR options and clears outdated outputs. */
  const setOptions = useCallback((options: OcrOptions): void => {
    dispatch({ type: "set-options", options });
  }, []);

  /** Runs OCR sequentially across all `"ready"` or `"error"` queue items. */
  const runAll = useCallback(async (): Promise<void> => {
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

  /** Unlocks a password-protected PDF and immediately processes it. */
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

  /** Selects which completed file's extracted text panel is shown. */
  const inspectText = useCallback((itemId: string | null): void => {
    dispatch({ type: "inspect-text", itemId });
  }, []);

  /** Cancels any active OCR job and restarts the Web Worker cleanly. */
  const cancel = useCallback((): void => {
    seqRef.current++;
    restartClient();
    dispatch({ type: "cancel-batch" });
  }, [restartClient]);

  /** Clears all queued files and resets the tool. */
  const clear = useCallback((): void => {
    seqRef.current++;
    restartClient();
    dispatch({ type: "clear" });
  }, [restartClient]);

  return {
    state,
    addFiles,
    removeFile,
    setOptions,
    runAll,
    submitPassword,
    dismissPassword,
    reopenPassword,
    inspectText,
    cancel,
    clear,
  };
}
