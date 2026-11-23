"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { createWorkerMergeClient, type MergeClient } from "./merge-client";
import {
  INITIAL_MERGE_STATE,
  mergeReducer,
  nextToCheck,
  type MergeAction,
  type MergeItem,
  type MergeState,
} from "./merge-state";
import type { InspectResult, MergeResult, MergeSource } from "./messages";

/** What the Merge PDFs page can see and do. */
export interface MergePdfs {
  state: MergeState;
  /** Append files to the list; each is checked in turn. */
  add(files: File[]): void;
  /** Re-check a locked file with this password. */
  submitPassword(id: string, password: string): void;
  /** Skip a file's password prompt for now. */
  dismissPassword(id: string): void;
  /** Show a skipped password prompt again. */
  reopenPassword(id: string): void;
  /** Move a file one place up (-1) or down (+1). */
  move(id: string, offset: -1 | 1): void;
  remove(id: string): void;
  clear(): void;
  /** Merge every file in list order. Ignored unless merging is allowed. */
  merge(): void;
}

/** Shown when a file disappeared or changed on disk after it was picked. */
export const UNREADABLE_FILE_MESSAGE =
  "Could not read this file. It may have been moved, renamed or changed.";

/**
 * Read a picked file into memory.
 *
 * @param file The file.
 * @returns Its bytes.
 * @throws An `Error` with {@link UNREADABLE_FILE_MESSAGE} when the browser
 *   cannot read it any more.
 */
async function readFile(file: File): Promise<ArrayBuffer> {
  try {
    return await file.arrayBuffer();
  } catch {
    throw new Error(UNREADABLE_FILE_MESSAGE);
  }
}

/** One of the files to merge could not be read; `index` says which. */
export class SourceReadError extends Error {
  /** @param index Position of the file in the merge order. */
  constructor(readonly index: number) {
    super(UNREADABLE_FILE_MESSAGE);
    this.name = "SourceReadError";
  }
}

/**
 * Read every file to merge, in list order, with the password that opened it.
 *
 * @param items The list (all files are "ready" when a merge starts).
 * @returns One source per file, for the worker.
 * @throws {SourceReadError} Naming the first file in the list that could not
 *   be read, so the error can say which one it was.
 */
export async function readSources(
  items: readonly MergeItem[],
): Promise<MergeSource[]> {
  const reads = items.map(async ({ file, status }, index) => {
    try {
      return {
        data: await readFile(file),
        password: status.kind === "ready" ? status.password : undefined,
      };
    } catch {
      throw new SourceReadError(index);
    }
  });
  // allSettled, not all: with several unreadable files, `all` would report
  // whichever read failed first in time; this names the first in the list.
  const settled = await Promise.allSettled(reads);
  const failed = settled.find((s) => s.status === "rejected");
  if (failed) throw failed.reason;
  return settled.map((s) => (s as PromiseFulfilledResult<MergeSource>).value);
}

/**
 * Phrase a merge error for the user, naming the file it is about.
 *
 * @param result The worker's error.
 * @param items The list as it was when the merge started (the worker's
 *   `sourceIndex` counts in that order).
 * @returns "name.pdf: message" when the failing file is known, else the message.
 */
export function describeMergeError(
  result: Extract<MergeResult, { status: "error" }>,
  items: readonly MergeItem[],
): string {
  const item =
    result.sourceIndex === undefined ? undefined : items[result.sourceIndex];
  return item ? `${item.file.name}: ${result.message}` : result.message;
}

/**
 * Check and merge PDFs in a Web Worker, and expose the list's state.
 *
 * State lives in the pure {@link mergeReducer}. It is applied synchronously
 * to a ref (`stateRef`) and then copied into React state, so async code (the
 * checking loop, a running merge) always reads the latest list rather than
 * the one from the render that started it.
 *
 * Checking files: `add` and `submitPassword` start `checkQueue`, which loops
 * while `nextToCheck` returns a file: mark it "checking", read it, ask the
 * worker, record the answer. `nextToCheck` returns nothing while a file is
 * being checked, so a second loop started meanwhile stops at once and files
 * are always checked one at a time.
 *
 * Late answers: after unmount the worker is terminated, which rejects the
 * pending request. Every await is followed by a check that the client is
 * still the current one, so nothing is dispatched after unmount.
 *
 * @param createClient Factory for the worker client (injected for tests).
 * @returns The state and the actions.
 */
export function useMergePdfs(
  createClient: () => MergeClient = createWorkerMergeClient,
): MergePdfs {
  const [state, setState] = useState(INITIAL_MERGE_STATE);
  const stateRef = useRef(state);
  const clientRef = useRef<MergeClient | null>(null);
  const factoryRef = useRef(createClient);
  const idRef = useRef(0);

  useEffect(() => {
    const client = factoryRef.current();
    clientRef.current = client;
    return () => {
      clientRef.current = null;
      client.terminate();
    };
  }, []);

  /** Apply an action now, and render if it changed anything. */
  const apply = useCallback((action: MergeAction) => {
    const next = mergeReducer(stateRef.current, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const checkQueue = useCallback(async () => {
    for (;;) {
      const client = clientRef.current;
      const next = nextToCheck(stateRef.current.items);
      if (!client || !next) return;
      const { id, file } = next;
      const password = next.status.password;
      apply({ type: "check-started", id });
      let result: InspectResult;
      try {
        result = await client.inspect({
          data: await readFile(file),
          password,
        });
      } catch (err) {
        result = {
          status: "error",
          reason: "failed",
          message: errorMessage(err),
        };
      }
      if (clientRef.current !== client) return; // unmounted
      apply({ type: "checked", id, result });
    }
  }, [apply]);

  const add = useCallback(
    (files: File[]) => {
      apply({
        type: "add",
        items: files.map((file) => ({ id: `m${++idRef.current}`, file })),
      });
      void checkQueue();
    },
    [apply, checkQueue],
  );

  const submitPassword = useCallback(
    (id: string, password: string) => {
      apply({ type: "submit-password", id, password });
      void checkQueue();
    },
    [apply, checkQueue],
  );

  const merge = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const before = stateRef.current;
    apply({ type: "merge-started" });
    // The reducer decides whether merging may start; unchanged = refused.
    if (stateRef.current === before) return;
    const { items } = before;
    let result: MergeResult;
    try {
      result = await client.merge(await readSources(items));
    } catch (err) {
      result = {
        status: "error",
        reason: "failed",
        message: errorMessage(err),
        sourceIndex: err instanceof SourceReadError ? err.index : undefined,
      };
    }
    if (clientRef.current !== client) return; // unmounted
    if (result.status === "merged") {
      apply({
        type: "merge-succeeded",
        pdf: new Blob([result.data], { type: "application/pdf" }),
        warnings: result.warnings,
      });
    } else {
      apply({
        type: "merge-failed",
        reason: result.reason,
        message: describeMergeError(result, items),
      });
    }
  }, [apply]);

  const dismissPassword = useCallback(
    (id: string) => apply({ type: "dismiss-password", id }),
    [apply],
  );
  const reopenPassword = useCallback(
    (id: string) => apply({ type: "reopen-password", id }),
    [apply],
  );
  const move = useCallback(
    (id: string, offset: -1 | 1) => apply({ type: "move", id, offset }),
    [apply],
  );
  const remove = useCallback(
    (id: string) => apply({ type: "remove", id }),
    [apply],
  );
  const clear = useCallback(() => apply({ type: "clear" }), [apply]);
  const startMerge = useCallback(() => void merge(), [merge]);

  return {
    state,
    add,
    submitPassword,
    dismissPassword,
    reopenPassword,
    move,
    remove,
    clear,
    merge: startMerge,
  };
}
