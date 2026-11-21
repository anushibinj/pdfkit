import { errorMessage } from "./errors";
import type { RequestOptions } from "./worker-client";

/**
 * The error result every session worker protocol shares.
 *
 * - "out-of-memory": the browser could not give the engine more memory;
 * - "crashed": the WebAssembly engine trapped or the worker died;
 * - "failed": an ordinary error; the worker is still usable.
 */
export interface SessionErrorResult {
  status: "error";
  reason: "out-of-memory" | "crashed" | "failed";
  message: string;
}

/** The part of `WorkerClient` a session needs (lets tests pass a fake). */
export interface SessionWorkerClient<Req, Res> {
  request(payload: Req, options?: RequestOptions): Promise<Res>;
  terminate(): void;
}

/** What differs between tools: how to open a file and what success looks like. */
export interface SessionProtocol<Req, Res> {
  /**
   * The request that opens a file.
   *
   * @param data A copy of the file (it is transferred).
   * @param password The user password, or "" for none.
   * @returns The request.
   */
  openRequest(data: ArrayBuffer, password: string): Req;
  /**
   * @param result A result of an open request.
   * @returns Whether the file is now open.
   */
  isOpened(result: Res): boolean;
  /** Message of the result returned for every request after dispose. */
  disposedMessage: string;
}

/** Extra inputs for {@link SessionWorker.request}. */
export interface SessionRequestOptions<Res> {
  /** Buffers to transfer instead of copy. */
  transfer?: Transferable[];
  /** Aborted when the caller no longer needs the result. */
  signal?: AbortSignal;
  /** Returned instead of running a request whose signal was aborted. */
  cancelled?: Res;
}

/**
 * Talks to a tool's worker on behalf of the UI, for workers that hold one
 * open file (a "session"), and hides worker crashes.
 *
 * Two problems it solves:
 *
 * 1. Ordering. Requests are chained one after another (`queue`), so a
 *    re-open after a crash can never interleave with a request that would
 *    then hit an empty worker. The worker handles one request at a time
 *    anyway, so nothing is lost by queueing here.
 *
 * 2. Crashes. A WebAssembly trap, an out-of-memory error or a dead worker
 *    leaves the engine unusable, so the worker is replaced (`restart`). The
 *    new worker has no file open, but the session kept the original bytes
 *    and password (`source`). It marks itself `stale` and silently re-opens
 *    the file before the next request. The user sees one error message for
 *    the failed request and can carry on without losing work.
 */
export class SessionWorker<Req, Res extends { status: string }> {
  private client: SessionWorkerClient<Req, Res | SessionErrorResult> | null =
    null;
  private source: { data: ArrayBuffer; password: string } | null = null;
  private stale = false;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly disposedResult: SessionErrorResult;

  /**
   * @param createClient Makes a worker client (one per worker lifetime).
   * @param protocol The tool's open request and success test.
   */
  constructor(
    private readonly createClient: () => SessionWorkerClient<
      Req,
      Res | SessionErrorResult
    >,
    private readonly protocol: SessionProtocol<Req, Res>,
  ) {
    this.disposedResult = {
      status: "error",
      reason: "failed",
      message: protocol.disposedMessage,
    };
  }

  /**
   * Open a file. A copy of `data` is transferred to the worker; the
   * original is kept for re-opening after a crash.
   *
   * @param data The PDF file.
   * @param password The user password, or "" for none.
   * @returns The worker's verdict.
   */
  open(data: ArrayBuffer, password: string): Promise<Res | SessionErrorResult> {
    return this.enqueue(async () => {
      const copy = data.slice(0);
      const result = await this.send(
        this.protocol.openRequest(copy, password),
        [copy],
      );
      this.source =
        result.status !== "error" && this.protocol.isOpened(result as Res)
          ? { data, password }
          : null;
      this.stale = false;
      return result;
    });
  }

  /**
   * Run a request about the open file, after re-opening it if the worker
   * was replaced.
   *
   * Requests wait in the queue, so by the time one reaches the front its
   * caller may no longer need it (a page scrolled away, newer settings). A
   * request whose `signal` was aborted by then is skipped and `cancelled`
   * returned instead of keeping the worker busy. A request already sent
   * cannot be stopped; its result is simply ignored by the caller.
   *
   * @param payload The request.
   * @param options Transfer list, abort signal and the cancelled result.
   * @returns The worker's result, an error, or `cancelled`.
   */
  request(
    payload: Req,
    options: SessionRequestOptions<Res> = {},
  ): Promise<Res | SessionErrorResult> {
    const { transfer, signal, cancelled } = options;
    return this.enqueue(async () => {
      if (signal?.aborted && cancelled) return cancelled;
      const failed = await this.reopenIfStale();
      if (failed) return failed;
      return this.send(payload, transfer);
    });
  }

  /**
   * Close the file in the worker and forget the kept bytes.
   *
   * @param payload The tool's close request.
   * @returns Resolves when the worker has closed it.
   */
  close(payload: Req): Promise<void> {
    return this.enqueue(async () => {
      this.source = null;
      this.stale = false;
      if (this.client) await this.send(payload);
    });
  }

  /** Stop the worker for good; later requests resolve with an error. */
  dispose(): void {
    this.disposed = true;
    this.source = null;
    this.client?.terminate();
    this.client = null;
  }

  /**
   * Run `task` after every earlier task has settled.
   *
   * `queue` always ends in a promise that resolves, even when a task
   * throws, so one failure never blocks the requests behind it. The caller
   * still receives the task's own outcome.
   *
   * @param task The work.
   * @returns The task's promise.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Send one request, creating the worker on first use.
   *
   * A rejected request means the worker itself died (or was terminated);
   * a "crashed" or "out-of-memory" result means it survived but its engine
   * cannot be trusted. Both replace the worker. After `dispose`, nothing is
   * sent and nothing restarts.
   *
   * @param payload The request.
   * @param transfer Buffers to transfer instead of copy.
   * @returns The worker's result, or a synthetic error.
   */
  private async send(
    payload: Req,
    transfer?: Transferable[],
  ): Promise<Res | SessionErrorResult> {
    if (this.disposed) return this.disposedResult;
    this.client ??= this.createClient();
    let result: Res | SessionErrorResult;
    try {
      result = await this.client.request(payload, { transfer });
    } catch (err) {
      if (this.disposed) return this.disposedResult;
      this.restart();
      return {
        status: "error",
        reason: "crashed",
        message: `The PDF engine stopped unexpectedly (${errorMessage(err)}). It has been restarted; please try again.`,
      };
    }
    if (isError(result) && result.reason !== "failed") this.restart();
    return result;
  }

  /** Replace the worker; a file that was open must be re-opened. */
  private restart(): void {
    this.client?.terminate();
    this.client = null;
    if (this.source) this.stale = true;
  }

  /**
   * After a restart, open the kept file again in the new worker.
   *
   * @returns `null` when ready, or the error that prevented re-opening (the
   *   kept file is then dropped, so the next request does not loop on it).
   */
  private async reopenIfStale(): Promise<SessionErrorResult | null> {
    if (!this.stale || !this.source) return null;
    this.stale = false;
    const { data, password } = this.source;
    const copy = data.slice(0);
    const result = await this.send(this.protocol.openRequest(copy, password), [
      copy,
    ]);
    if (!isError(result) && this.protocol.isOpened(result as Res)) return null;
    this.source = null;
    return isError(result)
      ? result
      : {
          status: "error",
          reason: "failed",
          message: "Could not reopen the PDF. Open it again.",
        };
  }
}

/**
 * @param result Any result.
 * @returns Whether it is the shared error shape.
 */
function isError(result: { status: string }): result is SessionErrorResult {
  return result.status === "error";
}
