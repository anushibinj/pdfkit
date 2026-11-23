/** Messages between the page organizer UI and its Web Worker. */
import type { PageInfo, QuarterTurns } from "@/lib/pdfium/page-box";
import type { SessionErrorResult } from "@/lib/session-worker";
import type { OutputPage } from "./core/output-plan";

/**
 * The error every request can answer with (the shape all session workers
 * share):
 * - "out-of-memory": the browser could not give the engine more memory;
 * - "crashed": the engine trapped; the worker must be replaced and the
 *   files opened again before it is used again;
 * - "failed": an ordinary error; the worker is still usable.
 */
export type ErrorResult = SessionErrorResult;

/** Why a request failed (see {@link ErrorResult}). */
export type FailureReason = ErrorResult["reason"];

export type OpenResult =
  | { status: "opened"; pages: PageInfo[] }
  /** The file is encrypted and no password was given. */
  | { status: "password-required" }
  /** A password was given and it is not the right one. */
  | { status: "wrong-password" }
  | ErrorResult;

export type OrganizeRequest =
  /** Open a file under `sourceId` (replacing one open under it). `data` is transferred. */
  | { op: "open"; sourceId: string; data: ArrayBuffer; password?: string }
  /** Render a page of an open file `width` pixels wide, turned by `rotation`. */
  | {
      op: "render";
      sourceId: string;
      pageIndex: number;
      rotation: QuarterTurns;
      width: number;
    }
  /** Build the organized file from these pages and return it. */
  | { op: "save"; pages: OutputPage[] }
  /** Close one file, or every file when `sourceId` is omitted. */
  | { op: "close"; sourceId?: string };

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
      /** The organized PDF (transferred). */
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

export type OrganizeResult = ResultFor[keyof ResultFor];
