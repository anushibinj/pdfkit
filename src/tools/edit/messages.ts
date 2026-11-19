/** Messages between the PDF editor UI and its Web Worker. */
import type { PageInfo, QuarterTurns } from "./core/model";
import type { SavePlan } from "./core/save-plan";

export type EditorRequest =
  /** Open a file (replacing any open one). `data` is transferred. */
  | { op: "open"; data: ArrayBuffer; password?: string }
  /** Render a page of the unedited file, `width` pixels wide. */
  | { op: "render"; pageIndex: number; rotation: QuarterTurns; width: number }
  /** Apply the plan to a fresh copy of the file and return the result. */
  | { op: "save"; plan: SavePlan }
  /** Close the file and free its memory. */
  | { op: "close" };

/**
 * - "out-of-memory": the browser could not give the engine more memory.
 * - "crashed": the WebAssembly engine trapped; the worker must be replaced
 *   (and the file opened again) before it is used again.
 * - "failed": an ordinary error; the worker is still usable.
 */
export type FailureReason = "out-of-memory" | "crashed" | "failed";

export interface ErrorResult {
  status: "error";
  reason: FailureReason;
  message: string;
}

export type OpenResult =
  | { status: "opened"; pages: PageInfo[] }
  /** The file is encrypted and no password was given. */
  | { status: "password-required" }
  /** A password was given and it is not the right one. */
  | { status: "wrong-password" }
  | ErrorResult;

export type RenderResult =
  | {
      status: "rendered";
      width: number;
      height: number;
      /** RGBA pixels, rows top to bottom (transferred). */
      pixels: ArrayBuffer;
    }
  | ErrorResult;

export type SaveResult =
  | {
      status: "saved";
      /** The edited PDF (transferred). */
      data: ArrayBuffer;
    }
  | ErrorResult;

export type CloseResult = { status: "closed" };

/** The result type for each request `op`. */
export interface ResultFor {
  open: OpenResult;
  render: RenderResult;
  save: SaveResult;
  close: CloseResult;
}

export type EditorResult = ResultFor[keyof ResultFor];
