"use client";

/**
 * Custom React hook managing the repair workflow, worker lifecycle, and UI state.
 *
 * Implements SOLID Principles:
 * - Single Responsibility: Coordinates asynchronous file reading, worker dispatching,
 *   and sequence tracking.
 * - Dependency Inversion: Permits injection of custom {@link RepairClient} for unit tests.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import {
  createWorkerRepairClient,
  type RepairClient,
} from "./repair-client";
import {
  INITIAL_REPAIR_STATE,
  repairReducer,
  type RepairState,
} from "./repair-state";

/** Public contract returned by {@link useRepairPdf}. */
export interface UseRepairPdfReturn {
  /** The current UI state of the repair tool. */
  state: RepairState;
  /** Selects a file and stages it for repair. */
  selectFile(file: File): void;
  /** Starts or retries repairing the staged file. */
  repair(password?: string): Promise<void>;
  /** Cancels any active repair job and restarts the worker. */
  cancel(): void;
  /** Clears the current file and resets to idle state. */
  clear(): void;
}

/**
 * Hook orchestrating PDF repair execution in a dedicated background worker.
 *
 * Employs a sequence token (`seqRef`) to guarantee that cancelled jobs or
 * stale responses from prior files never overwrite the active state.
 *
 * @param createClient Optional factory for creating the repair client (injected in tests).
 * @returns The repair controller and state.
 */
export function useRepairPdf(
  createClient: () => RepairClient = createWorkerRepairClient,
): UseRepairPdfReturn {
  const [state, dispatch] = useReducer(repairReducer, INITIAL_REPAIR_STATE);

  // Client instance initialized on mount and persisted across renders
  const clientRef = useRef<RepairClient | null>(null);

  // Sequence token tracking the currently active job
  const seqRef = useRef(0);

  /** Restarts the worker client, terminating any running work. */
  const restartClient = useCallback((): RepairClient => {
    clientRef.current?.terminate();
    const next = createClient();
    clientRef.current = next;
    return next;
  }, [createClient]);

  // Initialize client on mount and terminate on unmount
  useEffect(() => {
    clientRef.current = createClient();
    return () => {
      // Invalidate running job before terminating
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seqRef.current++;
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, [createClient]);

  /**
   * Selects a new file, cancelling any running operation.
   *
   * @param file The PDF file chosen by the user.
   */
  const selectFile = useCallback(
    (file: File): void => {
      seqRef.current++;
      restartClient();
      dispatch({ type: "select-file", file });
    },
    [restartClient],
  );

  /**
   * Resets the tool to its initial idle state.
   */
  const clear = useCallback((): void => {
    seqRef.current++;
    restartClient();
    dispatch({ type: "clear-file" });
  }, [restartClient]);

  /**
   * Cancels any active background repair operation.
   */
  const cancel = useCallback((): void => {
    seqRef.current++;
    restartClient();
    dispatch({ type: "cancel" });
  }, [restartClient]);

  /**
   * Reads the staged file and submits it to the repair worker.
   *
   * @param password Optional password if the document is encrypted.
   */
  const repair = useCallback(
    async (password?: string): Promise<void> => {
      if (
        state.kind !== "ready" &&
        state.kind !== "password-required" &&
        state.kind !== "unrecoverable" &&
        state.kind !== "error"
      ) {
        return;
      }

      const file = state.file;
      const seq = ++seqRef.current;

      dispatch({ type: "start-repair" });

      try {
        // Read file into an independent ArrayBuffer to transfer to worker
        const buffer = await file.arrayBuffer();

        // Check if job was cancelled while reading file
        if (seqRef.current !== seq) {
          return;
        }

        const client = clientRef.current ?? restartClient();
        const result = await client.repair(
          buffer,
          file.name,
          password,
          (progress, stage) => {
            if (seqRef.current === seq) {
              dispatch({ type: "progress", progress, stage });
            }
          },
        );

        // Check if job was cancelled while worker was processing
        if (seqRef.current !== seq) {
          return;
        }

        switch (result.status) {
          case "repaired": {
            const blob = new Blob([result.data], { type: "application/pdf" });
            dispatch({
              type: "repair-success",
              pdf: blob,
              pageCount: result.pageCount,
              report: result.report,
              warnings: result.warnings,
            });
            break;
          }

          case "password-required":
            dispatch({ type: "repair-password-required" });
            break;

          case "unrecoverable":
            dispatch({
              type: "repair-unrecoverable",
              reason: result.reason,
            });
            break;

          case "error":
            dispatch({
              type: "repair-error",
              message: result.message,
            });
            break;

          default:
            break;
        }
      } catch (err: unknown) {
        if (seqRef.current === seq) {
          dispatch({
            type: "repair-error",
            message: errorMessage(err) || "Failed to process PDF file.",
          });
        }
      }
    },
    [state, restartClient],
  );

  return {
    state,
    selectFile,
    repair,
    cancel,
    clear,
  };
}
