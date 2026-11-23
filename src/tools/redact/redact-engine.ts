import { errorMessage } from "@/lib/errors";
import type { PageBox } from "@/lib/pdfium/page-box";
import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { RedactionPlan } from "./core/model";
import type {
  ApplyResult,
  OpenResult,
  RedactErrorResult,
  RedactProgressStage,
  RedactRequest,
  RedactWorkerResult,
  RenderResult,
  SearchQuery,
  SearchResult,
  TextUnderBoxResult,
} from "./messages";

/** Worker client interface consumed by {@link RedactEngine} (DIP & testability). */
export interface RedactWorkerClient {
  request(
    payload: RedactRequest,
    options?: RequestOptions,
  ): Promise<RedactWorkerResult>;
  terminate(): void;
}

/**
 * Instantiate the real module Web Worker for Redact PDF.
 *
 * Kept inline in this tool's directory so Next.js / Turbopack statically bundles
 * `worker/pdf-redact.worker.ts` as its own worker chunk.
 *
 * @returns Lazily started {@link WorkerClient}.
 */
export function createRedactWorkerClient(): RedactWorkerClient {
  return new WorkerClient<RedactRequest, RedactWorkerResult>(
    () =>
      new Worker(new URL("./worker/pdf-redact.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/** Result returned for renders cancelled via `AbortSignal` while queued. */
export const CANCELLED: RedactErrorResult = {
  status: "error",
  reason: "failed",
  message: "Rendering was cancelled.",
};

const DISPOSED: RedactErrorResult = {
  status: "error",
  reason: "failed",
  message: "The redaction tool was closed.",
};

/**
 * Serialises worker requests, transfers buffers cleanly, and transparently
 * recovers from WebAssembly OOM or worker crashes by reopening the kept source
 * PDF in a fresh worker.
 */
export class RedactEngine {
  private client: RedactWorkerClient | null = null;
  private source: { bytes: ArrayBuffer; password: string } | null = null;
  private stale = false;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();

  /** @param createClient Factory for worker clients (injected in tests). */
  constructor(
    private readonly createClient: () => RedactWorkerClient = createRedactWorkerClient,
  ) {}

  /**
   * Open a PDF file (and optional password) in the worker.
   *
   * @param data Raw PDF file buffer.
   * @param password User password, or `""` when none.
   * @returns Opened page info, password prompt signal, or error.
   */
  open(data: ArrayBuffer, password = ""): Promise<OpenResult> {
    return this.enqueue(async () => {
      const copy = data.slice(0);
      const result = (await this.send({ op: "open", data: copy, password }, [
        copy,
      ])) as OpenResult;
      this.source =
        result.status === "opened" ? { bytes: data, password } : null;
      this.stale = false;
      return result;
    });
  }

  /**
   * Render one page for preview, skipping cancelled requests while queued.
   *
   * @param pageIndex Zero-based page index.
   * @param width Target width in pixels.
   * @param signal Optional `AbortSignal` to skip stale renders.
   * @returns Rendered RGBA pixel buffer or error.
   */
  render(
    pageIndex: number,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderResult> {
    return this.enqueue(async () => {
      if (signal?.aborted) return CANCELLED;
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({
        op: "render",
        pageIndex,
        width,
      })) as RenderResult;
    });
  }

  /**
   * Extract readable text inside a manually drawn redaction box.
   *
   * @param pageIndex Zero-based page index.
   * @param box User-space redaction box.
   * @returns Extracted text or error.
   */
  textUnderBox(pageIndex: number, box: PageBox): Promise<TextUnderBoxResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({
        op: "text-under-box",
        pageIndex,
        box,
      })) as TextUnderBoxResult;
    });
  }

  /**
   * Search the document for plain text, regex, or sensitive-data presets.
   *
   * @param query Search parameters.
   * @returns Candidate marks across pages or error.
   */
  search(query: SearchQuery): Promise<SearchResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({ op: "search", query })) as SearchResult;
    });
  }

  /**
   * Execute permanent redactions, document-wide sanitization, and post-save
   * verification in the worker.
   *
   * @param plan Full redaction plan.
   * @param onProgress Optional progress callback receiving stage and `0..1` fraction.
   * @returns Verified redacted bytes + report, verification failure, or error.
   */
  applyRedactions(
    plan: RedactionPlan,
    onProgress?: (stage: RedactProgressStage, fraction: number) => void,
  ): Promise<ApplyResult> {
    return this.enqueue(async () => {
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return (await this.send({ op: "apply", plan }, undefined, (p, stage) => {
        const mapped: RedactProgressStage =
          stage === "cleaning"
            ? "cleaning"
            : stage === "verifying"
              ? "verifying"
              : "redacting";
        onProgress?.(mapped, p);
      })) as ApplyResult;
    });
  }

  /** Close the currently open PDF inside the worker and clear cached source bytes. */
  close(): Promise<void> {
    return this.enqueue(async () => {
      this.source = null;
      this.stale = false;
      if (this.client) await this.send({ op: "close" });
    });
  }

  /** Permanently terminate the worker. */
  dispose(): void {
    this.disposed = true;
    this.source = null;
    this.client?.terminate();
    this.client = null;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  private async send(
    payload: RedactRequest,
    transfer?: Transferable[],
    onProgress?: (progress: number, stage?: string) => void,
  ): Promise<RedactWorkerResult> {
    if (this.disposed) return DISPOSED;
    this.client ??= this.createClient();
    let result: RedactWorkerResult;
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
    if (result.status === "error" && result.reason !== "failed") this.restart();
    return result;
  }

  private restart(): void {
    this.client?.terminate();
    this.client = null;
    if (this.source) this.stale = true;
  }

  private async reopenIfStale(): Promise<RedactErrorResult | null> {
    if (!this.stale || !this.source) return null;
    this.stale = false;
    const copy = this.source.bytes.slice(0);
    const result = await this.send(
      { op: "open", data: copy, password: this.source.password },
      [copy],
    );
    if (result.status === "opened") return null;
    this.source = null;
    return result.status === "error"
      ? result
      : {
          status: "error",
          reason: "failed",
          message: "Could not reopen the PDF. Open it again.",
        };
  }
}
