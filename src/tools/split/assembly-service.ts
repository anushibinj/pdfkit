import { errorMessage } from "@/lib/errors";
import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { AssembleRequest, AssembleResult, ErrorResult } from "./messages";

/** The part of `WorkerClient` the service needs (lets tests pass a fake). */
export interface AssembleWorkerClient {
  request(payload: AssembleRequest, options?: RequestOptions): Promise<AssembleResult>;
  terminate(): void;
}

/**
 * Create the real worker client. The `new Worker(new URL(...))` expression
 * has to be written out here so the bundler emits the worker as a chunk.
 *
 * @returns A client for a new, lazily started worker.
 */
export function createAssembleWorkerClient(): AssembleWorkerClient {
  return new WorkerClient<AssembleRequest, AssembleResult>(
    () =>
      new Worker(new URL("./worker/assemble.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/** Result of a run stopped with {@link AssemblyService.cancel}. */
export const CANCELLED: ErrorResult = {
  status: "error",
  reason: "failed",
  message: "Cancelled.",
};

/** Result for every run after {@link AssemblyService.dispose}. */
const DISPOSED: ErrorResult = {
  status: "error",
  reason: "failed",
  message: "The tool was closed.",
};

/**
 * Asks the assembly worker (qpdf) to build the output files.
 *
 * qpdf runs synchronously inside its worker, so the only way to stop a long
 * run is to terminate that worker. {@link cancel} does that and remembers
 * which worker it stopped, so the run that was waiting on it reports
 * "Cancelled." rather than a crash. The next run starts a new worker.
 *
 * A worker that died, crashed or ran out of memory is also replaced, so
 * the next run starts from a fresh engine.
 */
export class AssemblyService {
  private client: AssembleWorkerClient | null = null;
  private readonly cancelled = new WeakSet<AssembleWorkerClient>();
  private disposed = false;

  /** @param createClient Makes a worker client (one per worker lifetime). */
  constructor(
    private readonly createClient: () => AssembleWorkerClient = createAssembleWorkerClient,
  ) {}

  /**
   * Build the files. A copy of `data` is transferred; the caller keeps the
   * original for the next run.
   *
   * @param data The source PDF.
   * @param password The password it opened with, or "".
   * @param pageCount Pages in the source.
   * @param outputs Source page indices per output file.
   * @param onProgress Told the progress, 0..1.
   * @returns The files, a password problem, an error, or {@link CANCELLED}.
   */
  async assemble(
    data: ArrayBuffer,
    password: string,
    pageCount: number,
    outputs: number[][],
    onProgress?: (progress: number) => void,
  ): Promise<AssembleResult> {
    if (this.disposed) return DISPOSED;
    const client = (this.client ??= this.createClient());
    const copy = data.slice(0);
    try {
      const result = await client.request(
        { data: copy, password, pageCount, outputs },
        { transfer: [copy], onProgress: (p) => onProgress?.(p) },
      );
      if (result.status === "error" && result.reason !== "failed") this.drop(client);
      return result;
    } catch (err) {
      if (this.cancelled.has(client)) return CANCELLED;
      if (this.disposed) return DISPOSED;
      this.drop(client);
      return {
        status: "error",
        reason: "crashed",
        message: `The PDF engine stopped unexpectedly (${errorMessage(err)}). Please try again.`,
      };
    }
  }

  /** Stop the run in progress, if any. The next run starts a new worker. */
  cancel(): void {
    if (!this.client) return;
    this.cancelled.add(this.client);
    this.drop(this.client);
  }

  /** Stop for good; later runs resolve with an error. */
  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  /**
   * Terminate a worker and forget it if it is the current one.
   *
   * @param client The worker client to stop.
   */
  private drop(client: AssembleWorkerClient): void {
    client.terminate();
    if (this.client === client) this.client = null;
  }
}
