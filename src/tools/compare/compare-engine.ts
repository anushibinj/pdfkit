/**
 * Main-thread client facade over the Compare PDFs Web Worker.
 *
 * Serialises all requests via an internal promise queue and recovers
 * transparently from WASM runtime traps or OOM errors by spawning a fresh
 * worker and re-opening whichever sides were previously loaded.
 */
import { errorMessage } from "@/lib/errors";
import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { DocSide } from "./core/model";
import type {
  BuildReportResult,
  CompareErrorResult,
  CompareRequest,
  CompareWorkerResult,
  OpenSideResult,
  RenderPageResult,
  VisualDiffResult,
} from "./messages";

/** Minimal worker client interface required by {@link CompareEngine}. */
export interface CompareWorkerClient {
  request(
    payload: CompareRequest,
    options?: RequestOptions,
  ): Promise<CompareWorkerResult>;
  terminate(): void;
}

interface StoredSource {
  fileName: string;
  data: ArrayBuffer;
  password: string;
}

/** Result returned for render/diff requests aborted while waiting in queue. */
export const COMPARE_CANCELLED: CompareErrorResult = {
  status: "error",
  reason: "failed",
  message: "Request was cancelled.",
};

const DISPOSED: CompareErrorResult = {
  status: "error",
  reason: "failed",
  message: "The comparison session was closed.",
};

/**
 * Instantiate the real module Web Worker for Compare PDFs.
 *
 * @returns A lazily created {@link WorkerClient}.
 */
export function createCompareWorkerClient(): CompareWorkerClient {
  return new WorkerClient<CompareRequest, CompareWorkerResult>(
    () =>
      new Worker(new URL("./worker/compare.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/** Serialised, crash-resilient engine client for comparing two PDFs. */
export class CompareEngine {
  private client: CompareWorkerClient | null = null;
  private sources: Partial<Record<DocSide, StoredSource>> = {};
  private stale = false;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * @param createClient Worker client factory (injected in tests).
   */
  constructor(
    private readonly createClient: () => CompareWorkerClient = createCompareWorkerClient,
  ) {}

  /**
   * Open a PDF on `side` (`"left"` or `"right"`), keeping a copy of the source
   * bytes so the session can recover from a worker crash.
   *
   * @param side Target document slot.
   * @param fileName Filename for display and report export.
   * @param data Raw PDF file bytes.
   * @param password User password, or `""`.
   * @param onProgress Optional extraction progress callback.
   * @returns Worker open outcome (including comparison summary once both sides are open).
   */
  openSide(
    side: DocSide,
    fileName: string,
    data: ArrayBuffer,
    password: string,
    onProgress?: (fraction: number, stage?: string) => void,
  ): Promise<OpenSideResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale(side);
      if (failed) return failed;

      const copy = data.slice(0);
      const result = (await this.send(
        { op: "open", side, fileName, data: copy, password },
        [copy],
        onProgress,
      )) as OpenSideResult;

      if (result.status === "opened") {
        this.sources[side] = { fileName, data, password };
      } else {
        delete this.sources[side];
      }
      return result;
    });
  }

  /**
   * Render one page of `side` at `width` pixels.
   *
   * @param side `"left"` or `"right"`.
   * @param pageIndex Zero-based page index in that document.
   * @param width Target pixel width.
   * @param signal Optional abort signal checked before starting the queued job.
   * @returns Rendered RGBA bitmap or error/cancellation result.
   */
  renderPage(
    side: DocSide,
    pageIndex: number,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderPageResult> {
    return this.enqueue(async () => {
      if (signal?.aborted) return COMPARE_CANCELLED;
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({
        op: "render",
        side,
        pageIndex,
        width,
      })) as RenderPageResult;
    });
  }

  /**
   * Render both pages of aligned pair `pairIndex` at equal DPI and compute a
   * pixel-by-pixel visual difference overlay and change regions.
   *
   * @param pairIndex Zero-based index into `CompareSummary.pairs`.
   * @param width Target width in pixels for the wider page.
   * @param threshold Optional per-channel tolerance (`0..255`).
   * @param signal Optional abort signal.
   * @returns Diff RGBA pixels + {@link VisualDiffSummary}, or error/cancellation.
   */
  computeVisualDiff(
    pairIndex: number,
    width: number,
    threshold?: number,
    signal?: AbortSignal,
  ): Promise<VisualDiffResult> {
    return this.enqueue(async () => {
      if (signal?.aborted) return COMPARE_CANCELLED;
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({
        op: "visual-diff",
        pairIndex,
        width,
        threshold,
      })) as VisualDiffResult;
    });
  }

  /**
   * Generate the annotated Comparison Report PDF inside the worker.
   *
   * @param onProgress Optional progress callback.
   * @returns Report PDF bytes or error.
   */
  buildReport(
    onProgress?: (fraction: number, stage?: string) => void,
  ): Promise<BuildReportResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send(
        { op: "build-report" },
        undefined,
        onProgress,
      )) as BuildReportResult;
    });
  }

  /**
   * Close one side's PDF and drop its retained source bytes.
   *
   * @param side `"left"` or `"right"`.
   */
  closeSide(side: DocSide): Promise<void> {
    return this.enqueue(async () => {
      delete this.sources[side];
      if (this.client) {
        await this.send({ op: "close-side", side });
      }
    });
  }

  /** Close both PDFs while keeping the worker alive for subsequent files. */
  closeAll(): Promise<void> {
    return this.enqueue(async () => {
      this.sources = {};
      this.stale = false;
      if (this.client) {
        await this.send({ op: "close-all" });
      }
    });
  }

  /** Permanently terminate the worker; all subsequent requests fail cleanly. */
  dispose(): void {
    this.disposed = true;
    this.sources = {};
    this.client?.terminate();
    this.client = null;
  }

  /**
   * Serialise queued worker operations so failures never stall subsequent tasks.
   *
   * @param task Async operation to run after previous tasks settle.
   * @returns Promise resolving/rejecting with `task`'s outcome.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Dispatch one request, lazily spawning the worker and handling crashes/OOM.
   *
   * @param payload Typed worker request.
   * @param transfer Optional transferable buffers.
   * @param onProgress Optional progress listener.
   * @returns Typed worker response.
   */
  private async send(
    payload: CompareRequest,
    transfer?: Transferable[],
    onProgress?: (progress: number, stage?: string) => void,
  ): Promise<CompareWorkerResult> {
    if (this.disposed) return DISPOSED;
    this.client ??= this.createClient();
    let result: CompareWorkerResult;
    try {
      result = await this.client.request(payload, { transfer, onProgress });
    } catch (err) {
      if (this.disposed) return DISPOSED;
      this.restart();
      return {
        status: "error",
        reason: "crashed",
        message: `The PDF engine stopped unexpectedly (${errorMessage(err)}). It has been restarted; please try again.`,
      };
    }
    if (result.status === "error" && result.reason !== "failed") {
      this.restart();
    }
    return result;
  }

  /** Terminate a dead/corrupted worker and mark retained sides stale. */
  private restart(): void {
    this.client?.terminate();
    this.client = null;
    if (this.sources.left || this.sources.right) {
      this.stale = true;
    }
  }

  /**
   * Re-open any previously loaded sides after a worker restart, optionally
   * skipping `skipSide` when it is about to be replaced by a new `openSide`.
   *
   * @param skipSide Optional side being replaced right now.
   * @returns `null` on success, or the error that prevented re-opening.
   */
  private async reopenIfStale(
    skipSide?: DocSide,
  ): Promise<CompareErrorResult | null> {
    if (!this.stale) return null;
    this.stale = false;

    for (const side of ["left", "right"] as const) {
      if (side === skipSide) continue;
      const src = this.sources[side];
      if (!src) continue;
      const copy = src.data.slice(0);
      const res = (await this.send(
        {
          op: "open",
          side,
          fileName: src.fileName,
          data: copy,
          password: src.password,
        },
        [copy],
      )) as OpenSideResult;
      if (res.status !== "opened") {
        delete this.sources[side];
        return res.status === "error"
          ? res
          : {
              status: "error",
              reason: "failed",
              message: "Could not reopen the PDF after engine restart.",
            };
      }
    }
    return null;
  }
}
