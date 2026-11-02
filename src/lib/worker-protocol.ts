/**
 * Wire format shared by `WorkerClient` (main thread) and `exposeWorker`
 * (worker thread). Generic so every tool can reuse it.
 */
export interface SerializedError {
  name: string;
  message: string;
}

export interface WorkerRequest<Req> {
  id: number;
  payload: Req;
}

export type WorkerResponse<Res> =
  | { id: number; type: "result"; payload: Res }
  | { id: number; type: "error"; error: SerializedError }
  | { id: number; type: "progress"; progress: number; stage?: string };

export interface HandlerContext {
  /** Report progress in the range 0..1 */
  progress: (value: number, stage?: string) => void;
}

export interface HandlerResult<Res> {
  result: Res;
  /** Buffers to transfer (not copy) back to the main thread */
  transfer?: Transferable[];
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: "Error", message: String(err) };
}

/** Minimal slice of DedicatedWorkerGlobalScope that we need. */
export interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

/**
 * Call once at the top level of a worker file. Messages are processed one at a
 * time per request; errors are always reported back, never swallowed.
 */
export function exposeWorker<Req, Res>(
  scope: WorkerScope,
  handler: (payload: Req, ctx: HandlerContext) => Promise<HandlerResult<Res>>,
): void {
  scope.addEventListener("message", (event) => {
    const { id, payload } = event.data as WorkerRequest<Req>;
    const ctx: HandlerContext = {
      progress: (progress, stage) =>
        scope.postMessage({ id, type: "progress", progress, stage }),
    };
    handler(payload, ctx).then(
      ({ result, transfer }) => {
        const msg: WorkerResponse<Res> = { id, type: "result", payload: result };
        scope.postMessage(msg, transfer ?? []);
      },
      (err: unknown) => {
        const msg: WorkerResponse<Res> = {
          id,
          type: "error",
          error: serializeError(err),
        };
        scope.postMessage(msg);
      },
    );
  });
}
