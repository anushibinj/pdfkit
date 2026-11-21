import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type {
  InspectResult,
  MergeResult,
  MergeSource,
  MergeWorkerRequest,
  MergeWorkerResult,
} from "./messages";

/** What the Merge PDFs hook needs from the worker (lets tests pass a fake). */
export interface MergeClient {
  /**
   * Check one file. Its buffer is transferred, so it is unusable afterwards.
   *
   * @param source The file and its password, if any.
   * @returns What the worker found.
   */
  inspect(source: MergeSource): Promise<InspectResult>;
  /**
   * Merge the files in order. Their buffers are transferred.
   *
   * @param sources The files, in output order.
   * @returns The merged PDF or why it failed.
   */
  merge(sources: MergeSource[]): Promise<MergeResult>;
  /** Stop the worker and reject anything in flight. */
  terminate(): void;
}

/** The part of `WorkerClient` the adapter uses. */
export interface MergeRequestSender {
  request(
    payload: MergeWorkerRequest,
    options?: RequestOptions,
  ): Promise<MergeWorkerResult>;
  terminate(): void;
}

/**
 * {@link MergeClient} over the generic worker client.
 *
 * The worker answers every request with the union `MergeWorkerResult`; the
 * handler always answers "inspect" with an `InspectResult` and "merge" with a
 * `MergeResult` (see `createMergeHandler`). The narrowing casts below rely on
 * that contract, and keeping them here means no other code has to.
 */
export class WorkerMergeClient implements MergeClient {
  /** @param sender Sends requests to the worker. */
  constructor(private readonly sender: MergeRequestSender) {}

  /**
   * Send an "inspect" request, transferring the file's buffer.
   *
   * @inheritdoc
   */
  inspect(source: MergeSource): Promise<InspectResult> {
    return this.sender.request(
      { op: "inspect", source },
      { transfer: [source.data] },
    ) as Promise<InspectResult>;
  }

  /**
   * Send a "merge" request, transferring every file's buffer.
   *
   * A buffer may appear only once in a transfer list (`postMessage` throws
   * `DataCloneError` otherwise), so the list is de-duplicated in case two
   * sources ever share one.
   *
   * @inheritdoc
   */
  merge(sources: MergeSource[]): Promise<MergeResult> {
    const transfer = [...new Set(sources.map((s) => s.data))];
    return this.sender.request(
      { op: "merge", sources },
      { transfer },
    ) as Promise<MergeResult>;
  }

  /**
   * Terminate the underlying worker.
   *
   * @inheritdoc
   */
  terminate(): void {
    this.sender.terminate();
  }
}

/**
 * Create the real client. The `new Worker(new URL(...))` expression has to be
 * written out here, in the tool's own code, so the bundler can find the
 * worker file and emit it as a separate chunk.
 *
 * @returns A client for a new, lazily started worker.
 */
export function createWorkerMergeClient(): MergeClient {
  return new WorkerMergeClient(
    new WorkerClient<MergeWorkerRequest, MergeWorkerResult>(
      () =>
        new Worker(new URL("./worker/merge.worker.ts", import.meta.url), {
          type: "module",
        }),
    ),
  );
}
