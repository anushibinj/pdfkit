/** Messages between the page organizer UI and its Web Worker. */
import type { QuarterTurns } from "@/tools/edit/core/model";
import type { ErrorResult, OpenResult } from "@/tools/edit/messages";
import type { OutputPage } from "./core/output-plan";

export type {
  ErrorResult,
  FailureReason,
  OpenResult,
} from "@/tools/edit/messages";

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
