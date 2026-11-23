"use client";

/**
 * React hook owning the {@link CompareEngine} lifecycle, dual-PDF opening and
 * password prompts, page bitmap rendering, visual diff computation, and report
 * PDF export.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { CompareEngine } from "./compare-engine";
import type { CompareSummary, DocSide } from "./core/model";
import type {
  BuildReportResult,
  RenderPageResult,
  VisualDiffResult,
} from "./messages";

/** UI state of one PDF slot (`left` or `right`). */
export type SideSlotState =
  | { kind: "empty" }
  | { kind: "opening"; fileName: string; progress: number; stage: string }
  | {
      kind: "needs-password";
      fileName: string;
      file: File;
      bytes: ArrayBuffer;
      wrong: boolean;
      busy: boolean;
    }
  | {
      kind: "ready";
      fileName: string;
      pageCount: number;
      scannedPages: number;
    }
  | { kind: "failed"; fileName: string; message: string };

/** Export job state for the Comparison Report PDF. */
export type ReportJobState =
  | { kind: "idle" }
  | { kind: "building"; stage: string }
  | { kind: "error"; message: string };

/** Complete public API returned by {@link usePdfCompare}. */
export interface PdfCompareController {
  left: SideSlotState;
  right: SideSlotState;
  summary: CompareSummary | null;
  reportJob: ReportJobState;
  openFile(side: DocSide, file: File): Promise<void>;
  submitPassword(side: DocSide, password: string): Promise<void>;
  clearSide(side: DocSide): void;
  resetAll(): void;
  swapSides(): Promise<void>;
  renderPage(
    side: DocSide,
    pageIndex: number,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderPageResult>;
  computeVisualDiff(
    pairIndex: number,
    width: number,
    threshold?: number,
    signal?: AbortSignal,
  ): Promise<VisualDiffResult>;
  exportReport(): Promise<BuildReportResult>;
}

const UNMOUNTED_ERROR = {
  status: "error",
  reason: "failed",
  message: "The comparison tool was closed.",
} as const;

/**
 * Own the worker-backed PDF comparison session for the Compare PDFs UI.
 *
 * @param createEngine Optional {@link CompareEngine} factory (injected in tests).
 * @returns Reactive state and action callbacks for both PDF slots and views.
 */
export function usePdfCompare(
  createEngine: () => CompareEngine = () => new CompareEngine(),
): PdfCompareController {
  const [left, setLeft] = useState<SideSlotState>({ kind: "empty" });
  const [right, setRight] = useState<SideSlotState>({ kind: "empty" });
  const [summary, setSummary] = useState<CompareSummary | null>(null);
  const [reportJob, setReportJob] = useState<ReportJobState>({ kind: "idle" });

  const engineRef = useRef<CompareEngine | null>(null);
  const factoryRef = useRef(createEngine);
  const seqRef = useRef<{ left: number; right: number }>({ left: 0, right: 0 });
  const filesRef = useRef<{
    left?: { file: File; password: string };
    right?: { file: File; password: string };
  }>({});

  useEffect(() => {
    const engine = factoryRef.current();
    engineRef.current = engine;
    const seq = seqRef.current;
    return () => {
      seq.left++;
      seq.right++;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const setSide = useCallback((side: DocSide, next: SideSlotState) => {
    if (side === "left") setLeft(next);
    else setRight(next);
  }, []);

  const openWithBytes = useCallback(
    async (
      side: DocSide,
      file: File,
      bytes: ArrayBuffer,
      password: string,
      mine: number,
    ) => {
      const engine = engineRef.current;
      if (!engine) return;

      const result = await engine.openSide(
        side,
        file.name,
        bytes,
        password,
        (fraction, stage) => {
          if (seqRef.current[side] !== mine) return;
          setSide(side, {
            kind: "opening",
            fileName: file.name,
            progress: fraction,
            stage: stage ?? "Reading PDF…",
          });
        },
      );

      if (seqRef.current[side] !== mine) return;

      if (result.status === "opened") {
        filesRef.current[side] = { file, password };
        setSide(side, {
          kind: "ready",
          fileName: file.name,
          pageCount: result.pageCount,
          scannedPages: result.scannedPages,
        });
        setSummary(result.summary);
        setReportJob({ kind: "idle" });
      } else if (result.status === "needs-password") {
        setSide(side, {
          kind: "needs-password",
          fileName: file.name,
          file,
          bytes,
          wrong: result.wrong,
          busy: false,
        });
        setSummary(null);
      } else {
        delete filesRef.current[side];
        setSide(side, {
          kind: "failed",
          fileName: file.name,
          message: result.message,
        });
        setSummary(null);
      }
    },
    [setSide],
  );

  const openFile = useCallback(
    async (side: DocSide, file: File) => {
      const mine = ++seqRef.current[side];
      setSummary(null);
      setReportJob({ kind: "idle" });
      setSide(side, {
        kind: "opening",
        fileName: file.name,
        progress: 0,
        stage: "Loading file…",
      });

      let bytes: ArrayBuffer;
      try {
        bytes = await file.arrayBuffer();
      } catch (err) {
        if (seqRef.current[side] === mine) {
          setSide(side, {
            kind: "failed",
            fileName: file.name,
            message: errorMessage(err),
          });
        }
        return;
      }

      if (seqRef.current[side] !== mine) return;
      await openWithBytes(side, file, bytes, "", mine);
    },
    [openWithBytes, setSide],
  );

  const submitPassword = useCallback(
    async (side: DocSide, password: string) => {
      const current = side === "left" ? left : right;
      if (current.kind !== "needs-password") return;
      const mine = ++seqRef.current[side];
      setSide(side, { ...current, busy: true });
      await openWithBytes(side, current.file, current.bytes, password, mine);
    },
    [left, right, openWithBytes, setSide],
  );

  const clearSide = useCallback(
    (side: DocSide) => {
      seqRef.current[side]++;
      delete filesRef.current[side];
      setSide(side, { kind: "empty" });
      setSummary(null);
      setReportJob({ kind: "idle" });
      void engineRef.current?.closeSide(side);
    },
    [setSide],
  );

  const resetAll = useCallback(() => {
    seqRef.current.left++;
    seqRef.current.right++;
    filesRef.current = {};
    setLeft({ kind: "empty" });
    setRight({ kind: "empty" });
    setSummary(null);
    setReportJob({ kind: "idle" });
    void engineRef.current?.closeAll();
  }, []);

  const swapSides = useCallback(async () => {
    const prevLeft = filesRef.current.left;
    const prevRight = filesRef.current.right;
    if (!prevLeft && !prevRight) return;

    seqRef.current.left++;
    seqRef.current.right++;
    filesRef.current = {};
    setSummary(null);
    setReportJob({ kind: "idle" });
    await engineRef.current?.closeAll();

    if (prevRight) {
      const mine = ++seqRef.current.left;
      setLeft({
        kind: "opening",
        fileName: prevRight.file.name,
        progress: 0,
        stage: "Swapping…",
      });
      const buf = await prevRight.file.arrayBuffer();
      if (seqRef.current.left === mine) {
        await openWithBytes(
          "left",
          prevRight.file,
          buf,
          prevRight.password,
          mine,
        );
      }
    } else {
      setLeft({ kind: "empty" });
    }

    if (prevLeft) {
      const mine = ++seqRef.current.right;
      setRight({
        kind: "opening",
        fileName: prevLeft.file.name,
        progress: 0,
        stage: "Swapping…",
      });
      const buf = await prevLeft.file.arrayBuffer();
      if (seqRef.current.right === mine) {
        await openWithBytes(
          "right",
          prevLeft.file,
          buf,
          prevLeft.password,
          mine,
        );
      }
    } else {
      setRight({ kind: "empty" });
    }
  }, [openWithBytes]);

  const renderPage = useCallback(
    (
      side: DocSide,
      pageIndex: number,
      width: number,
      signal?: AbortSignal,
    ): Promise<RenderPageResult> =>
      engineRef.current?.renderPage(side, pageIndex, width, signal) ??
      Promise.resolve(UNMOUNTED_ERROR),
    [],
  );

  const computeVisualDiff = useCallback(
    (
      pairIndex: number,
      width: number,
      threshold?: number,
      signal?: AbortSignal,
    ): Promise<VisualDiffResult> =>
      engineRef.current?.computeVisualDiff(pairIndex, width, threshold, signal) ??
      Promise.resolve(UNMOUNTED_ERROR),
    [],
  );

  const exportReport = useCallback(async (): Promise<BuildReportResult> => {
    const engine = engineRef.current;
    if (!engine) return UNMOUNTED_ERROR;
    setReportJob({ kind: "building", stage: "Building report PDF…" });
    const result = await engine.buildReport((_fraction, stage) => {
      setReportJob({ kind: "building", stage: stage ?? "Building report PDF…" });
    });
    if (result.status === "report") {
      setReportJob({ kind: "idle" });
    } else {
      setReportJob({ kind: "error", message: result.message });
    }
    return result;
  }, []);

  return {
    left,
    right,
    summary,
    reportJob,
    openFile,
    submitPassword,
    clearSide,
    resetAll,
    swapSides,
    renderPage,
    computeVisualDiff,
    exportReport,
  };
}
