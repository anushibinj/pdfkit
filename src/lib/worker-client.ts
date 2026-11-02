import type {
  SerializedError,
  WorkerRequest,
  WorkerResponse,
} from "./worker-protocol";

/** The subset of `Worker` we use (lets tests pass a fake). */
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export class WorkerError extends Error {
  constructor({ name, message }: SerializedError) {
    super(message);
    this.name = name;
  }
}

export interface RequestOptions {
  /** ArrayBuffers etc. to transfer instead of copy */
  transfer?: Transferable[];
  onProgress?: (progress: number, stage?: string) => void;
}

interface Pending<Res> {
  resolve: (value: Res) => void;
  reject: (reason: Error) => void;
  onProgress?: RequestOptions["onProgress"];
}

/**
 * Promise based request/response over a Worker.
 *
 * The worker is created lazily by `factory`. The `new Worker(new URL(...))`
 * expression must live in the tool's own code so the bundler can see it.
 */
export class WorkerClient<Req, Res> {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending<Res>>();
  private terminated = false;

  constructor(private readonly factory: () => WorkerLike) {}

  request(payload: Req, options: RequestOptions = {}): Promise<Res> {
    if (this.terminated) {
      return Promise.reject(new Error("Worker has been terminated"));
    }
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<Res>((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        onProgress: options.onProgress,
      });
      const message: WorkerRequest<Req> = { id, payload };
      try {
        worker.postMessage(message, options.transfer ?? []);
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Reject everything in flight and stop the worker. Safe to call twice. */
  terminate(): void {
    this.terminated = true;
    this.worker?.terminate();
    this.worker = null;
    this.rejectAll(new Error("Worker has been terminated"));
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.factory();
    worker.addEventListener("message", (e) =>
      this.onMessage(e.data as WorkerResponse<Res>),
    );
    worker.addEventListener("error", (e) => {
      // A crashed worker cannot answer: fail everything and start fresh next time.
      const message = e.message || "The worker crashed";
      this.worker?.terminate();
      this.worker = null;
      this.rejectAll(new Error(message));
    });
    this.worker = worker;
    return worker;
  }

  private onMessage(msg: WorkerResponse<Res>): void {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    if (msg.type === "progress") {
      entry.onProgress?.(msg.progress, msg.stage);
      return;
    }
    this.pending.delete(msg.id);
    if (msg.type === "result") entry.resolve(msg.payload);
    else entry.reject(new WorkerError(msg.error));
  }

  private rejectAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}
