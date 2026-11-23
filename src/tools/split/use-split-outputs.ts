"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AssemblyService, CANCELLED } from "./assembly-service";
import type { AssembleResult } from "./messages";
import type { DocumentSource } from "./use-split-document";

/** One built file, ready to download. */
export interface OutputFile {
  name: string;
  /** Source page indices (0-based) it holds. */
  pages: number[];
  data: ArrayBuffer;
  crc32: number;
}

/**
 * Where building the files stands. `key` identifies the plan the state
 * belongs to, so the UI can hide results that no longer match the settings
 * without any effect or reset call (see `planKey`).
 */
export type OutputsState =
  | { kind: "idle" }
  | { kind: "working"; key: string; progress: number }
  | { kind: "done"; key: string; files: OutputFile[]; warnings?: string }
  | { kind: "failed"; key: string; message: string };

/** What to build. */
export interface BuildRequest {
  /** Identifies the plan (see `planKey`). */
  key: string;
  source: DocumentSource;
  pageCount: number;
  /** One entry per file: its name and source page indices. */
  outputs: { name: string; pages: number[] }[];
}

/** The build state and its actions. */
export interface SplitOutputs {
  state: OutputsState;
  /**
   * Build the files (replacing any earlier result).
   *
   * @returns The state the build ended in, or null when it was replaced
   *   (cancelled, reset or unmounted) before it ended.
   */
  build(request: BuildRequest): Promise<OutputsState | null>;
  /** Stop a build in progress. */
  cancel(): void;
  /** Forget results (e.g. when another file is opened); stops a build. */
  reset(): void;
}

/**
 * Own the assembly worker and the built files.
 *
 * Each build takes the next sequence number; progress and results are
 * applied only while that number is still current, so a build that was
 * cancelled, or replaced by a reset, can never overwrite newer state.
 *
 * @param createService Factory for the service (injected for tests).
 * @returns The state and actions.
 */
export function useSplitOutputs(
  createService: () => AssemblyService = () => new AssemblyService(),
): SplitOutputs {
  const [state, setState] = useState<OutputsState>({ kind: "idle" });
  const serviceRef = useRef<AssemblyService | null>(null);
  const factoryRef = useRef(createService);
  const runSeq = useRef(0);
  const working = useRef(false);

  useEffect(() => {
    const service = factoryRef.current();
    serviceRef.current = service;
    return () => {
      // A plain counter, not a DOM ref: reading its latest value is intended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runSeq.current++;
      service.dispose();
      serviceRef.current = null;
    };
  }, []);

  const build = useCallback(async (request: BuildRequest) => {
    const service = serviceRef.current;
    if (!service) return null;
    const seq = ++runSeq.current;
    const { key } = request;
    working.current = true;
    setState({ kind: "working", key, progress: 0 });
    const result = await service.assemble(
      request.source.data,
      request.source.password,
      request.pageCount,
      request.outputs.map((o) => o.pages),
      (progress) => {
        if (seq === runSeq.current) setState({ kind: "working", key, progress });
      },
    );
    if (seq !== runSeq.current) return null;
    working.current = false;
    const next = finalState(key, request, result);
    setState(next);
    return next;
  }, []);

  /** Stop the build, if one is running, and go back to idle. */
  const stop = useCallback(() => {
    runSeq.current++;
    // Only a running build is worth stopping: cancelling an idle worker
    // would just make the next build load qpdf again.
    if (working.current) serviceRef.current?.cancel();
    working.current = false;
    setState({ kind: "idle" });
  }, []);

  return { state, build, cancel: stop, reset: stop };
}

/**
 * The state a finished build ends in.
 *
 * Built files get the names and pages of the outputs they were made for
 * (the worker returns them in request order). A cancelled build goes back
 * to idle rather than showing "Cancelled." as an error.
 *
 * @param key The plan's key.
 * @param request What was asked for.
 * @param result What the worker answered.
 * @returns The new state.
 */
export function finalState(
  key: string,
  request: BuildRequest,
  result: AssembleResult,
): OutputsState {
  switch (result.status) {
    case "assembled":
      return {
        kind: "done",
        key,
        warnings: result.warnings,
        files: result.files.map((file, i) => ({
          name: request.outputs[i].name,
          pages: request.outputs[i].pages,
          data: file.data,
          crc32: file.crc32,
        })),
      };
    case "wrong-password":
      return {
        kind: "failed",
        key,
        message: "The password was not accepted while making the files. Open the PDF again.",
      };
    case "error":
      return result === CANCELLED
        ? { kind: "idle" }
        : { kind: "failed", key, message: result.message };
  }
}
