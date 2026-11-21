"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import {
  INITIAL_CONVERSION_STATE,
  conversionReducer,
  type ConversionState,
} from "./conversion-state";
import type { ConvertResult } from "./types";

/**
 * The part of `WorkerClient` this hook needs (lets tests pass a fake).
 *
 * @typeParam Req The tool's own request message.
 */
export interface ConversionClient<Req> {
  request(payload: Req): Promise<ConvertResult>;
  terminate(): void;
}

/**
 * What {@link usePdfConversion} gives a tool page.
 *
 * @typeParam Req The tool's own request message.
 */
export interface PdfConversion<Req> {
  state: ConversionState;
  /** Start converting. Ignored while a conversion is already running. */
  convert(request: Req): void;
  /** Stop the running conversion (restarts the worker). */
  cancel(): void;
  /** Tell the hook the input changed, so a finished PDF is now stale. */
  inputChanged(): void;
}

/**
 * Run PDF conversions in a Web Worker and expose their state. Shared by every
 * ironpress-based tool; each tool passes a factory for its own worker, because
 * the `new Worker(new URL(...))` expression must live in the tool's code for
 * the bundler to find the worker file.
 *
 * Cancelling is the tricky part. A synchronous WebAssembly call cannot be
 * interrupted from outside, so the only way to stop it is to terminate the
 * worker. Each request therefore carries a sequence number (`seqRef`):
 * 1. `convert` increments the number and remembers its own value.
 * 2. `cancel` increments it too, then terminates the worker. That rejects the
 *    pending request with "Worker has been terminated".
 * 3. When any request settles, it compares its remembered number with the
 *    current one. If they differ, the request was cancelled (or replaced) and
 *    its outcome is ignored, so that rejection never shows up as an error.
 * The worker is replaced the same way after a crash or out-of-memory error,
 * because a trapped WebAssembly instance cannot be reused.
 *
 * @typeParam Req The tool's own request message.
 * @param createClient Factory for the worker client. Only the factory passed
 *   on the first render is used (it is kept in a ref), so an inline arrow
 *   function does not restart the worker on every render.
 * @returns The current state and the actions.
 */
export function usePdfConversion<Req>(
  createClient: () => ConversionClient<Req>,
): PdfConversion<Req> {
  const [state, dispatch] = useReducer(
    conversionReducer,
    INITIAL_CONVERSION_STATE,
  );
  const clientRef = useRef<ConversionClient<Req> | null>(null);
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
      // Invalidate in-flight requests. Without this, terminating the worker
      // below would reject the pending request, and its handler would start a
      // new worker after unmount. seqRef is a plain counter, not a DOM ref, so
      // reading its latest value here is intended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seqRef.current++;
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  const convert = useCallback(
    (request: Req) => {
      const client = clientRef.current;
      if (!client || busyRef.current) return;
      busyRef.current = true;
      const seq = ++seqRef.current;
      dispatch({ type: "start" });
      client.request(request).then(
        (result) => {
          if (seq !== seqRef.current) return;
          busyRef.current = false;
          if (result.status === "converted") {
            dispatch({
              type: "succeed",
              pdf: new Blob([result.data], { type: "application/pdf" }),
            });
            return;
          }
          if (result.reason !== "failed") restartClient();
          dispatch({
            type: "fail",
            reason: result.reason,
            message: result.message,
          });
        },
        (err: unknown) => {
          if (seq !== seqRef.current) return;
          busyRef.current = false;
          // The worker itself failed (crashed while loading, for example).
          restartClient();
          dispatch({
            type: "fail",
            reason: "crashed",
            message: errorMessage(err),
          });
        },
      );
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

  const inputChanged = useCallback(
    () => dispatch({ type: "input-changed" }),
    [],
  );

  return { state, convert, cancel, inputChanged };
}
