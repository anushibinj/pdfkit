import { errorMessage } from "@/lib/errors";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { PageInfo, QuarterTurns } from "@/tools/edit/core/model";
import { isQuarterTurns } from "@/tools/edit/core/page-geometry";
import type { RenderedPage } from "@/tools/edit/engine/pdfium-document";
import { openResult, toErrorResult } from "@/tools/edit/worker/edit-handler";
import type { OrganizeRequest, OrganizeResult } from "../messages";

/** What the handler needs from the worker's session (`OrganizeSession`). */
export interface Session {
  open(sourceId: unknown, bytes: Uint8Array, password: string): PageInfo[];
  render(
    sourceId: unknown,
    pageIndex: number,
    turns: QuarterTurns,
    width: number,
  ): RenderedPage;
  save(pages: unknown): Uint8Array;
  close(sourceId?: unknown): void;
}

/**
 * Run one request against the session.
 *
 * Inputs are re-checked here or in the session, because a message can
 * carry anything: an unknown rotation renders unturned, the source id and
 * the output pages are validated by the session. Opening shares the
 * editor's `openResult`, so a password-protected file is reported the same
 * way in both tools.
 *
 * @param session The worker's session.
 * @param request The request.
 * @returns The result and the buffers to transfer back.
 */
export function handleRequest(
  session: Session,
  request: OrganizeRequest,
): HandlerResult<OrganizeResult> {
  switch (request.op) {
    case "open":
      return {
        result: openResult(
          (password) =>
            session.open(
              request.sourceId,
              new Uint8Array(request.data),
              password,
            ),
          request.password,
        ),
      };
    case "render": {
      const turns = isQuarterTurns(request.rotation) ? request.rotation : 0;
      const page = session.render(
        request.sourceId,
        request.pageIndex,
        turns,
        request.width,
      );
      const pixels = toTransferableBuffer(page.pixels);
      return {
        result: {
          status: "rendered",
          width: page.width,
          height: page.height,
          pixels,
        },
        transfer: [pixels],
      };
    }
    case "save": {
      const data = toTransferableBuffer(session.save(request.pages));
      return { result: { status: "saved", data }, transfer: [data] };
    }
    case "close":
      session.close(request.sourceId);
      return { result: { status: "closed" } };
    default:
      return {
        result: {
          status: "error",
          reason: "failed",
          message: "Unknown request.",
        },
      };
  }
}

/**
 * Build the function the worker exposes with `exposeWorker`.
 *
 * Flow for one request:
 * 1. Get the session. The first request downloads and compiles PDFium,
 *    which can fail (offline, blocked); that is reported as "Could not load
 *    the PDF engine" instead of a raw error. A "close" needs no engine.
 * 2. Run the request. Every exception becomes a typed result (the editor's
 *    `toErrorResult`: out of memory, engine crash, rejected plan, other), so
 *    the promise never rejects and the UI handles one shape per request.
 *
 * @param getSession Resolves to the session (memoised by the caller).
 * @returns The request handler.
 */
export function createOrganizeHandler(
  getSession: () => Promise<Session>,
): (
  request: OrganizeRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<OrganizeResult>> {
  return async (request) => {
    let session: Session;
    try {
      session = await getSession();
    } catch (err) {
      if (request.op === "close") return { result: { status: "closed" } };
      return {
        result: {
          status: "error",
          reason: "failed",
          message: `Could not load the PDF engine: ${errorMessage(err)}`,
        },
      };
    }
    try {
      return handleRequest(session, request);
    } catch (err) {
      return { result: toErrorResult(err) };
    }
  };
}
