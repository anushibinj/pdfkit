"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WorkerClient } from "@/lib/worker-client";
import type { UnlockRequest, UnlockResult } from "./messages";

export type ItemState =
  | { kind: "queued"; password?: string }
  | { kind: "processing"; progress: number }
  | { kind: "not-encrypted" }
  | { kind: "needs-password"; wrong: boolean; dismissed: boolean }
  | {
      kind: "done";
      via: "owner" | "password";
      blob: Blob;
      newSize: number;
      warnings?: string;
    }
  | { kind: "error"; message: string; reason: "out-of-memory" | "failed" };

export interface UnlockItem {
  id: string;
  file: File;
  state: ItemState;
}

type Announce = (message: string) => void;

/**
 * Owns the worker and a one-at-a-time queue (one file at a time keeps memory
 * use predictable). Items are mirrored in a ref so the queue can be driven
 * from async callbacks without stale state.
 */
export function useUnlockQueue(announce: Announce) {
  const [items, setItems] = useState<UnlockItem[]>([]);
  const itemsRef = useRef<UnlockItem[]>([]);
  const clientRef = useRef<WorkerClient<UnlockRequest, UnlockResult> | null>(
    null,
  );
  const runningRef = useRef(false);
  const idRef = useRef(0);
  const announceRef = useRef(announce);
  useEffect(() => {
    announceRef.current = announce;
  });

  const commit = useCallback((next: UnlockItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patch = useCallback(
    (id: string, state: ItemState) => {
      commit(
        itemsRef.current.map((i) => (i.id === id ? { ...i, state } : i)),
      );
    },
    [commit],
  );

  useEffect(() => {
    const client = new WorkerClient<UnlockRequest, UnlockResult>(
      () =>
        new Worker(new URL("./worker/qpdf.worker.ts", import.meta.url), {
          type: "module",
        }),
    );
    clientRef.current = client;
    return () => {
      client.terminate();
      clientRef.current = null;
    };
  }, []);

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.state.kind === "queued");
        const client = clientRef.current;
        if (!next || !client || next.state.kind !== "queued") break;
        const { id, file } = next;
        const password = next.state.password;
        patch(id, { kind: "processing", progress: 10 });
        let result: UnlockResult;
        try {
          const data = await file.arrayBuffer();
          patch(id, { kind: "processing", progress: 25 });
          result = await client.request(
            { data, password },
            {
              transfer: [data],
              onProgress: (p) => {
                if (itemsRef.current.some((i) => i.id === id)) {
                  patch(id, {
                    kind: "processing",
                    progress: 25 + Math.round(p * 50),
                  });
                }
              },
            },
          );
        } catch (err) {
          if (clientRef.current !== client) break; // unmounted
          result = {
            status: "error",
            reason: "failed",
            message: err instanceof Error ? err.message : String(err),
          };
        }
        // The user may have cleared or removed the file meanwhile.
        if (!itemsRef.current.some((i) => i.id === id)) continue;
        const name = file.name;
        switch (result.status) {
          case "not-encrypted":
            patch(id, { kind: "not-encrypted" });
            announceRef.current(`${name} is not encrypted. Nothing to unlock.`);
            break;
          case "password-required":
            patch(id, { kind: "needs-password", wrong: false, dismissed: false });
            announceRef.current(`${name} needs a password.`);
            break;
          case "wrong-password":
            patch(id, { kind: "needs-password", wrong: true, dismissed: false });
            announceRef.current(`Wrong password for ${name}. Try again.`);
            break;
          case "unlocked":
            patch(id, {
              kind: "done",
              via: result.via,
              blob: new Blob([result.data], { type: "application/pdf" }),
              newSize: result.data.byteLength,
              warnings: result.warnings,
            });
            announceRef.current(`${name} unlocked. Ready to download.`);
            break;
          case "error":
            patch(id, {
              kind: "error",
              message: result.message,
              reason: result.reason,
            });
            announceRef.current(`Could not unlock ${name}. ${result.message}`);
            break;
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [patch]);

  const add = useCallback(
    (files: File[]) => {
      const added: UnlockItem[] = files.map((file) => ({
        id: `f${++idRef.current}`,
        file,
        state: { kind: "queued" },
      }));
      commit([...itemsRef.current, ...added]);
      void pump();
    },
    [commit, pump],
  );

  const submitPassword = useCallback(
    (id: string, password: string) => {
      patch(id, { kind: "queued", password });
      void pump();
    },
    [patch, pump],
  );

  const dismissPrompt = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (item?.state.kind === "needs-password") {
        patch(id, { ...item.state, dismissed: true });
      }
    },
    [patch],
  );

  const reopenPrompt = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (item?.state.kind === "needs-password") {
        patch(id, { ...item.state, dismissed: false });
      }
    },
    [patch],
  );

  const remove = useCallback(
    (id: string) => commit(itemsRef.current.filter((i) => i.id !== id)),
    [commit],
  );
  const clear = useCallback(() => commit([]), [commit]);

  return { items, add, submitPassword, dismissPrompt, reopenPrompt, remove, clear };
}
