"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { PageBox } from "@/lib/pdfium/page-box";
import type { RedactionMark, RedactionPlan } from "./core/model";
import {
  IDLE_JOB,
  INITIAL_DOCUMENT_STATUS,
  documentReducer,
  type DocumentStatus,
  type JobStatus,
} from "./document-state";
import type { ApplyResult, RenderResult, SearchQuery } from "./messages";
import { RedactEngine } from "./redact-engine";

/** Hook surface exposed to the Redact PDF UI components. */
export interface PdfRedact {
  status: DocumentStatus;
  job: JobStatus;
  openFile(file: File): Promise<void>;
  submitPassword(password: string): Promise<void>;
  close(): void;
  renderPage(
    pageIndex: number,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderResult>;
  extractTextUnderBox(pageIndex: number, box: PageBox): Promise<string>;
  search(query: SearchQuery): Promise<Omit<RedactionMark, "id">[] | null>;
  applyRedactions(plan: RedactionPlan): Promise<void>;
  resetJob(): void;
}

const UNMOUNTED: RenderResult = {
  status: "error",
  reason: "failed",
  message: "The redaction tool was closed.",
};

/**
 * Convert an {@link ApplyResult} from the worker into a {@link JobStatus}.
 *
 * @param result Worker response for `"apply"`.
 * @returns Done status with verified bytes, or failed status refusing download.
 */
export function jobFromApplyResult(result: ApplyResult): JobStatus {
  switch (result.status) {
    case "redacted":
      return { kind: "done", data: result.data, report: result.report };
    case "verification-failed":
      return { kind: "failed", message: result.message };
    case "error":
      return { kind: "failed", message: result.message };
  }
}

/**
 * Own the {@link RedactEngine} worker lifecycle and coordinate file opening,
 * password retry, page rendering, search/preset matching, and verified
 * redaction execution.
 *
 * @param createEngine Factory for the worker engine (injected for tests).
 * @returns State and async action handlers for the UI.
 */
export function usePdfRedact(
  createEngine: () => RedactEngine = () => new RedactEngine(),
): PdfRedact {
  const [status, dispatch] = useReducer(
    documentReducer,
    INITIAL_DOCUMENT_STATUS,
  );
  const [job, setJob] = useState<JobStatus>(IDLE_JOB);
  const engineRef = useRef<RedactEngine | null>(null);
  const factoryRef = useRef(createEngine);
  const pendingFileRef = useRef<{ name: string; data: ArrayBuffer } | null>(
    null,
  );
  const seq = useRef(0);

  useEffect(() => {
    const engine = factoryRef.current();
    engineRef.current = engine;
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seq.current++;
      pendingFileRef.current = null;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const openWithPassword = useCallback(
    async (fileName: string, data: ArrayBuffer, password: string) => {
      const engine = engineRef.current;
      if (!engine) return;
      const mine = ++seq.current;
      dispatch({ type: "opening", fileName });
      const result = await engine.open(data, password);
      if (mine !== seq.current) return;
      if (result.status !== "needs-password") {
        pendingFileRef.current = null;
      }
      dispatch({ type: "opened", result });
    },
    [],
  );

  const openFile = useCallback(
    async (file: File) => {
      const engine = engineRef.current;
      if (!engine) return;
      const mine = ++seq.current;
      setJob(IDLE_JOB);
      let data: ArrayBuffer;
      try {
        data = await file.arrayBuffer();
      } catch (err) {
        if (mine === seq.current) {
          dispatch({
            type: "read-failed",
            fileName: file.name,
            message: errorMessage(err),
          });
        }
        return;
      }
      if (mine !== seq.current) return;
      pendingFileRef.current = { name: file.name, data };
      await openWithPassword(file.name, data, "");
    },
    [openWithPassword],
  );

  const submitPassword = useCallback(
    async (password: string) => {
      const pending = pendingFileRef.current;
      if (!pending) return;
      await openWithPassword(pending.name, pending.data, password);
    },
    [openWithPassword],
  );

  const close = useCallback(() => {
    seq.current++;
    pendingFileRef.current = null;
    void engineRef.current?.close();
    setJob(IDLE_JOB);
    dispatch({ type: "reset" });
  }, []);

  const renderPage = useCallback(
    (pageIndex: number, width: number, signal?: AbortSignal) =>
      engineRef.current?.render(pageIndex, width, signal) ??
      Promise.resolve(UNMOUNTED),
    [],
  );

  const extractTextUnderBox = useCallback(
    async (pageIndex: number, box: PageBox): Promise<string> => {
      const engine = engineRef.current;
      if (!engine) return "";
      const res = await engine.textUnderBox(pageIndex, box);
      return res.status === "text-extracted" ? res.text : "";
    },
    [],
  );

  const search = useCallback(
    async (query: SearchQuery): Promise<Omit<RedactionMark, "id">[] | null> => {
      const engine = engineRef.current;
      if (!engine) return null;
      const res = await engine.search(query);
      if (res.status === "searched") return res.matches;
      throw new Error(res.message);
    },
    [],
  );

  const applyRedactions = useCallback(async (plan: RedactionPlan) => {
    const engine = engineRef.current;
    if (!engine) return;
    const mine = seq.current;
    setJob({ kind: "working", stage: "redacting", fraction: 0 });
    const result = await engine.applyRedactions(plan, (stage, fraction) => {
      if (mine === seq.current) setJob({ kind: "working", stage, fraction });
    });
    if (mine === seq.current) setJob(jobFromApplyResult(result));
  }, []);

  const resetJob = useCallback(() => setJob(IDLE_JOB), []);

  return {
    status,
    job,
    openFile,
    submitPassword,
    close,
    renderPage,
    extractTextUnderBox,
    search,
    applyRedactions,
    resetJob,
  };
}
