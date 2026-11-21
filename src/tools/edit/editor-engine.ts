import { SessionWorker } from "@/lib/session-worker";
import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { QuarterTurns, TextEdit } from "./core/model";
import type { SavePlan } from "./core/save-plan";
import type {
  EditorRequest,
  EditorResult,
  ErrorResult,
  OpenResult,
  RenderResult,
  SaveResult,
  TextRunsResult,
} from "./messages";

/** Extra inputs for {@link EditorEngine.render}. */
export interface RenderOptions {
  /** Aborted when the caller no longer needs the result. */
  signal?: AbortSignal;
  /** Changes to the page's own text, applied for this render only. */
  textEdits?: TextEdit[];
}

/** The part of `WorkerClient` the engine needs (lets tests pass a fake). */
export interface EditorWorkerClient {
  request(
    payload: EditorRequest,
    options?: RequestOptions,
  ): Promise<EditorResult>;
  terminate(): void;
}

/**
 * Create the real worker client. The `new Worker(new URL(...))` expression
 * has to be written out here, in the tool's own code, so the bundler can
 * find the worker file and emit it as a separate chunk.
 *
 * @returns A client for a new, lazily started worker.
 */
export function createEditorWorkerClient(): EditorWorkerClient {
  return new WorkerClient<EditorRequest, EditorResult>(
    () =>
      new Worker(new URL("./worker/pdf-edit.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/** Result of a render skipped because its caller aborted it while queued. */
export const CANCELLED: ErrorResult = {
  status: "error",
  reason: "failed",
  message: "Rendering was cancelled.",
};

/**
 * Talks to the editor worker on behalf of the UI. Ordering, crash
 * recovery and re-opening after a crash are handled by the shared
 * {@link SessionWorker}; this class only builds the editor's requests.
 */
export class EditorEngine {
  private readonly session: SessionWorker<EditorRequest, EditorResult>;

  /** @param createClient Makes a worker client (one per worker lifetime). */
  constructor(
    createClient: () => EditorWorkerClient = createEditorWorkerClient,
  ) {
    this.session = new SessionWorker<EditorRequest, EditorResult>(
      createClient,
      {
        openRequest: (data, password) => ({ op: "open", data, password }),
        isOpened: (result) => result.status === "opened",
        disposedMessage: "The editor was closed.",
      },
    );
  }

  /**
   * Open a file. A copy of `data` is transferred to the worker; the
   * original is kept for re-opening after a crash.
   *
   * @param data The PDF file.
   * @param password The user password, or "" for none.
   * @returns The worker's verdict.
   */
  open(data: ArrayBuffer, password = ""): Promise<OpenResult> {
    return this.session.open(data, password) as Promise<OpenResult>;
  }

  /**
   * Render a page of the file, with the given text edits applied.
   *
   * By the time a queued render reaches the front the page may have
   * scrolled away (fast scrolling through a long file queues many). A
   * render whose `signal` was aborted by then is skipped and
   * {@link CANCELLED} returned.
   *
   * @param pageIndex Source page index.
   * @param rotation User quarter turns to add.
   * @param width Requested bitmap width in pixels.
   * @param options Abort signal and text edits.
   * @returns The pixels, an error, or {@link CANCELLED}.
   */
  render(
    pageIndex: number,
    rotation: QuarterTurns,
    width: number,
    options: RenderOptions = {},
  ): Promise<RenderResult> {
    const { signal, textEdits = [] } = options;
    return this.session.request(
      { op: "render", pageIndex, rotation, width, textEdits },
      { signal, cancelled: CANCELLED },
    ) as Promise<RenderResult>;
  }

  /**
   * List the editable lines of text on a page of the original file.
   *
   * @param pageIndex Source page index.
   * @returns The lines, or an error.
   */
  textRuns(pageIndex: number): Promise<TextRunsResult> {
    return this.session.request({
      op: "text-runs",
      pageIndex,
    }) as Promise<TextRunsResult>;
  }

  /**
   * Produce the edited file. Image bytes in the plan are copied (not
   * transferred): the UI keeps them for later saves.
   *
   * @param plan What to change.
   * @returns The new file or an error.
   */
  save(plan: SavePlan): Promise<SaveResult> {
    return this.session.request({ op: "save", plan }) as Promise<SaveResult>;
  }

  /**
   * Close the file in the worker and forget the kept bytes.
   *
   * @returns Resolves when the worker has closed it.
   */
  close(): Promise<void> {
    return this.session.close({ op: "close" });
  }

  /** Stop the worker for good; later requests resolve with an error. */
  dispose(): void {
    this.session.dispose();
  }
}
