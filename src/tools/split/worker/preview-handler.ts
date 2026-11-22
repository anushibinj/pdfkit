import { errorMessage } from "@/lib/errors";
import { PdfOpenError, type RenderedPage } from "@/lib/pdfium/pdfium-document";
import { toTransferableBuffer } from "@/lib/transfer";
import type { HandlerContext, HandlerResult } from "@/lib/worker-protocol";
import type { PageSize, PreviewRequest, PreviewResult } from "../messages";
import { toErrorResult } from "./error-result";

/** What the handler needs from the worker's session (`PreviewSession`). */
export interface PreviewSessionLike {
  open(bytes: Uint8Array, password: string): PageSize[];
  render(pageIndex: number, width: number): RenderedPage;
  close(): void;
}

/**
 * Run one preview request against the session.
 *
 * A missing or non-string password becomes "" (none). For "open", a
 * password error is split in two so the UI can phrase it right: no password
 * given means "this file needs one", a refused password means "that one is
 * wrong". Other open failures (not a PDF, unsupported encryption) carry
 * PDFium's classified message.
 *
 * @param session The worker's session.
 * @param request The request (untrusted).
 * @returns The result and the buffers to transfer back.
 * @throws Whatever the session throws for render (handled by the caller).
 */
export function handlePreviewRequest(
  session: PreviewSessionLike,
  request: PreviewRequest,
): HandlerResult<PreviewResult> {
  switch (request.op) {
    case "open": {
      const password =
        typeof request.password === "string" ? request.password : "";
      if (!(request.data instanceof ArrayBuffer)) {
        return {
          result: { status: "error", reason: "failed", message: "No file was received." },
        };
      }
      try {
        const pages = session.open(new Uint8Array(request.data), password);
        return { result: { status: "opened", pages } };
      } catch (err) {
        if (err instanceof PdfOpenError) {
          if (err.reason === "password") {
            return {
              result: {
                status: password === "" ? "password-required" : "wrong-password",
              },
            };
          }
          return {
            result: { status: "error", reason: "failed", message: err.message },
          };
        }
        return { result: toErrorResult(err, "opening the PDF") };
      }
    }
    case "render": {
      const page = session.render(request.pageIndex, request.width);
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
    case "close":
      session.close();
      return { result: { status: "closed" } };
    default:
      return {
        result: { status: "error", reason: "failed", message: "Unknown request." },
      };
  }
}

/**
 * Build the function the preview worker exposes with `exposeWorker`.
 *
 * 1. Get the session. The first request downloads and compiles PDFium,
 *    which can fail (offline, blocked); that is reported as "Could not
 *    load the PDF engine" instead of a raw error. A "close" needs no
 *    engine, so it succeeds even then.
 * 2. Run the request. Every exception becomes a typed result, so the
 *    promise never rejects and the UI handles one shape per request.
 *
 * @param getSession Resolves to the session (memoised by the caller).
 * @returns The request handler.
 */
export function createPreviewHandler(
  getSession: () => Promise<PreviewSessionLike>,
): (
  request: PreviewRequest,
  ctx: HandlerContext,
) => Promise<HandlerResult<PreviewResult>> {
  return async (request) => {
    let session: PreviewSessionLike;
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
      return handlePreviewRequest(session, request);
    } catch (err) {
      return { result: toErrorResult(err, "drawing the page") };
    }
  };
}
