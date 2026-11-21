"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import { WorkerClient } from "@/lib/worker-client";
import type { ProtectRequest, ProtectResult } from "./messages";
import {
  INITIAL_PROTECTION_STATE,
  protectionReducer,
  type ProtectionAction,
  type ProtectionState,
} from "./protection-state";

/** The part of `WorkerClient` this hook needs (lets tests pass a fake). */
export interface ProtectionClient {
  request(
    payload: ProtectRequest,
    options?: { transfer?: Transferable[] },
  ): Promise<ProtectResult>;
  terminate(): void;
}

/**
 * Create the real worker client. The `new Worker(new URL(...))` expression has
 * to be written out here, in the tool's own code, so the bundler can find the
 * worker file and emit it as a separate chunk.
 *
 * @returns A client for a new, lazily started worker.
 */
export function createWorkerProtectionClient(): ProtectionClient {
  return new WorkerClient<ProtectRequest, ProtectResult>(
    () =>
      new Worker(new URL("./worker/protect.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/**
 * Turn the worker's answer into a state action.
 *
 * @param result The worker's result.
 * @returns The action to dispatch.
 */
export function resultToAction(result: ProtectResult): ProtectionAction {
  switch (result.status) {
    case "protected":
      return {
        type: "succeed",
        pdf: new Blob([result.data], { type: "application/pdf" }),
        replacedRestrictions: result.replacedRestrictions,
        invalidatedSignatures: result.invalidatedSignatures,
        warnings: result.warnings,
      };
    case "already-protected":
      return { type: "refuse" };
    case "error":
      return { type: "fail", reason: result.reason, message: result.message };
  }
}

export interface PdfProtection {
  state: ProtectionState;
  /** Start protecting. Ignored while a job is already running. */
  protect(file: File, password: string): void;
  /** Stop the running job (restarts the worker). */
  cancel(): void;
  /** Tell the hook the password changed, so a finished PDF is now stale. */
  passwordChanged(): void;
  /** Tell the hook the file changed, so every result is now stale. */
  fileChanged(): void;
}

/**
 * Protect PDFs in a Web Worker and expose the job's state.
 *
 * A job has two asynchronous steps: reading the file into memory, then the
 * worker's request. Cancelling is handled with a sequence number (`seqRef`),
 * because a synchronous WebAssembly call cannot be interrupted, only its
 * worker terminated:
 * 1. `protect` increments the number and remembers its own value.
 * 2. `cancel` (and unmounting) increments it too, then terminates the
 *    worker, which rejects the pending request.
 * 3. After each `await`, the job compares its value with the current one. If
 *    they differ, the job was cancelled, and it stops without touching the
 *    state, so the rejection caused by terminating never shows as an error.
 * The worker is also replaced after an out-of-memory error (to give the
 * memory back) and after a rejected request (the worker died).
 *
 * @param createClient Factory for the worker client (injected for tests).
 * @returns The current state and the actions.
 */
export function usePdfProtection(
  createClient: () => ProtectionClient = createWorkerProtectionClient,
): PdfProtection {
  const [state, dispatch] = useReducer(
    protectionReducer,
    INITIAL_PROTECTION_STATE,
  );
  const clientRef = useRef<ProtectionClient | null>(null);
  const factoryRef = useRef(createClient);
  const seqRef = useRef(0);
  const busyRef = useRef(false);

  /** Replace the worker with a fresh one (the old one is terminated). */
  const restartClient = useCallback(() => {
    clientRef.current?.terminate();
    clientRef.current = factoryRef.current();
  }, []);

  useEffect(() => {
    clientRef.current = factoryRef.current();
    return () => {
      // Invalidate the running job before terminating, so its rejection is
      // ignored and does not start a new worker after unmount. seqRef is a
      // plain counter, not a DOM ref, so reading its latest value is intended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seqRef.current++;
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  const protect = useCallback(
    (file: File, password: string) => {
      const client = clientRef.current;
      if (!client || busyRef.current) return;
      busyRef.current = true;
      const seq = ++seqRef.current;
      /** Whether this job is still the latest (not cancelled or replaced). */
      const current = () => seq === seqRef.current;
      /** Settle the job: unlock and dispatch, unless it was cancelled. */
      const finish = (action: ProtectionAction) => {
        busyRef.current = false;
        dispatch(action);
      };
      dispatch({ type: "start" });

      void (async () => {
        let data: ArrayBuffer;
        try {
          data = await file.arrayBuffer();
        } catch {
          if (current()) {
            finish({
              type: "fail",
              reason: "failed",
              message: `Could not read ${file.name}.`,
            });
          }
          return;
        }
        if (!current()) return;

        let result: ProtectResult;
        try {
          result = await client.request(
            { data, password },
            { transfer: [data] },
          );
        } catch (err) {
          if (!current()) return;
          restartClient();
          finish({
            type: "fail",
            reason: "crashed",
            message: errorMessage(err),
          });
          return;
        }
        if (!current()) return;
        if (result.status === "error" && result.reason === "out-of-memory") {
          restartClient();
        }
        finish(resultToAction(result));
      })();
    },
    [restartClient],
  );

  const cancel = useCallback(() => {
    if (!busyRef.current) return;
    busyRef.current = false;
    seqRef.current++;
    restartClient();
    dispatch({ type: "cancel" });
  }, [restartClient]);

  const passwordChanged = useCallback(
    () => dispatch({ type: "password-changed" }),
    [],
  );
  const fileChanged = useCallback(() => dispatch({ type: "file-changed" }), []);

  return { state, protect, cancel, passwordChanged, fileChanged };
}
