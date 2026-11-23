"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { CropPlan } from "./core/crop-plan";
import { CropEngine } from "./crop-engine";
import {
  IDLE_JOB,
  INITIAL_DOCUMENT_STATUS,
  documentReducer,
  type DocumentStatus,
  type JobStatus,
} from "./document-state";
import type { CropResult, RenderResult } from "./messages";

/** Everything the crop UI needs from the engine, in one place. */
export interface PdfCrop {
  status: DocumentStatus;
  job: JobStatus;
  /** Read and open a PDF the user picked. */
  openFile(file: File): Promise<void>;
  /** Close the file and start over. */
  close(): void;
  /** Render a page as displayed (stable identity across renders). */
  renderPage(
    pageIndex: number,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderResult>;
  /** Crop the open file; the outcome arrives in `job`. */
  crop(plan: CropPlan): Promise<void>;
  /** Forget the last crop's outcome (back to the settings). */
  resetJob(): void;
}

/** Result for requests made after the component unmounted. */
const UNMOUNTED = {
  status: "error",
  reason: "failed",
  message: "The cropper was closed.",
} as const;

/**
 * The job status for the worker's answer to a crop.
 *
 * @param result The answer.
 * @param removeOutside Whether the crop removed content.
 * @returns "done", or "failed" with a message for people.
 */
export function jobFromResult(
  result: CropResult,
  removeOutside: boolean,
): JobStatus {
  switch (result.status) {
    case "cropped":
      return {
        kind: "done",
        data: result.data,
        report: result.report,
        removeOutside,
      };
    case "check-failed":
      return {
        kind: "failed",
        message: `The cropped file did not pass the safety check, so it is not offered for download: ${result.message} Please try again without "Remove what's outside".`,
      };
    case "error":
      return { kind: "failed", message: result.message };
  }
}

/**
 * Own the crop engine and the tool's state.
 *
 * Opening and cropping use a sequence number (`seq`): each new file, and
 * closing, take the next number, and an answer is applied only if no newer
 * file was picked or the file closed while it was in flight.
 *
 * @param createEngine Factory for the engine (injected for tests).
 * @returns The state and actions.
 */
export function usePdfCrop(
  createEngine: () => CropEngine = () => new CropEngine(),
): PdfCrop {
  const [status, dispatch] = useReducer(
    documentReducer,
    INITIAL_DOCUMENT_STATUS,
  );
  const [job, setJob] = useState<JobStatus>(IDLE_JOB);
  const engineRef = useRef<CropEngine | null>(null);
  const factoryRef = useRef(createEngine);
  const seq = useRef(0);

  useEffect(() => {
    const engine = factoryRef.current();
    engineRef.current = engine;
    return () => {
      // seq is a plain counter, not a DOM ref: reading its latest value is
      // intended. Invalidate anything in flight, then stop the worker.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seq.current++;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const openFile = useCallback(async (file: File) => {
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
    dispatch({ type: "opening", fileName: file.name });
    const result = await engine.open(data);
    if (mine === seq.current) dispatch({ type: "opened", result });
  }, []);

  const close = useCallback(() => {
    seq.current++;
    void engineRef.current?.close();
    setJob(IDLE_JOB);
    dispatch({ type: "reset" });
  }, []);

  const renderPage = useCallback(
    (pageIndex: number, width: number, signal?: AbortSignal) =>
      engineRef.current?.render(pageIndex, width, signal) ??
      Promise.resolve<RenderResult>(UNMOUNTED),
    [],
  );

  const crop = useCallback(async (plan: CropPlan) => {
    const engine = engineRef.current;
    if (!engine) return;
    const mine = seq.current;
    setJob({ kind: "working", stage: "cropping", fraction: 0 });
    const result = await engine.crop(plan, (stage, fraction) => {
      if (mine === seq.current) setJob({ kind: "working", stage, fraction });
    });
    if (mine === seq.current) setJob(jobFromResult(result, plan.removeOutside));
  }, []);

  const resetJob = useCallback(() => setJob(IDLE_JOB), []);

  return { status, job, openFile, close, renderPage, crop, resetJob };
}
