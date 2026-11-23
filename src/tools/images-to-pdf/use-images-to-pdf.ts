"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canDecodeImage, type ImageDecoder } from "@/lib/decode-image";
import { errorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import {
  MAX_IMAGE_BYTES,
  readImageInfo,
  type ImageInfo,
} from "@/lib/image-info";
import {
  INITIAL_IMAGES_STATE,
  imagesReducer,
  imagesSummary,
  nextToValidate,
  type ImageListItem,
  type ImagesToPdfAction,
  type ImagesToPdfState,
} from "./core/images-state";
import type { PageLayoutOptions } from "./core/options";
import {
  createWorkerImagesToPdfClient,
  type ImagesToPdfClient,
} from "./images-to-pdf-client";
import type { BuildPdfResult, ImagePageInput } from "./messages";

/** Public state and actions exposed to the Images to PDF page. */
export interface ImagesToPdfController {
  state: ImagesToPdfState;
  /** Append picked/dropped image files; each is validated sequentially. */
  add(files: File[]): void;
  /** Move an image one position up (`-1`) or down (`+1`). */
  move(id: string, offset: -1 | 1): void;
  /** Rotate an image 90° clockwise (`1`) or counter-clockwise (`-1`). */
  rotate(id: string, delta: 1 | -1): void;
  /** Remove one image and release its preview URL. */
  remove(id: string): void;
  /** Remove all images and release all preview URLs. */
  clear(): void;
  /** Update paper size, orientation, margin, or scaling options. */
  setOptions(options: PageLayoutOptions): void;
  /** Build the PDF in the Web Worker. Ignored if blocked or already building. */
  build(): void;
}

/** Shown when a picked file can no longer be read from disk. */
export const UNREADABLE_FILE_MESSAGE =
  "Could not read this file. It may have been moved, renamed or changed.";

/** Shown when a file does not have a valid PNG or JPEG header. */
export const UNSUPPORTED_IMAGE_MESSAGE =
  "This file is not a valid PNG or JPEG image.";

/** Shown when an image has a valid header but fails browser decoding. */
export const CORRUPT_IMAGE_MESSAGE =
  "This image appears damaged and could not be decoded.";

/** Error thrown when reading one of the source files fails at build time. */
export class ImageReadError extends Error {
  /** @param index Zero-based index of the file that could not be read. */
  constructor(readonly index: number) {
    super(UNREADABLE_FILE_MESSAGE);
    this.name = "ImageReadError";
  }
}

/**
 * Validate a single image file on the main thread before conversion:
 * 1. Rejects files exceeding {@link MAX_IMAGE_BYTES} (20 MB) to guard memory.
 * 2. Reads bytes and inspects magic bytes + dimensions via {@link readImageInfo}.
 * 3. Runs {@link canDecodeImage} so truncated/corrupted images fail immediately
 *    instead of failing late inside the PDFium worker.
 *
 * @param file Picked or dropped file.
 * @param decode Optional image decoder override (injected for unit tests).
 * @returns Validated {@link ImageInfo} on success, or an error message string.
 */
export async function validateImageFile(
  file: File,
  decode?: ImageDecoder,
): Promise<{ ok: true; info: ImageInfo } | { ok: false; message: string }> {
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      message: `Image is larger than ${formatBytes(MAX_IMAGE_BYTES)}.`,
    };
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return { ok: false, message: UNREADABLE_FILE_MESSAGE };
  }

  const info = readImageInfo(new Uint8Array(buffer));
  if (!info) {
    return { ok: false, message: UNSUPPORTED_IMAGE_MESSAGE };
  }

  const decodable = await canDecodeImage(buffer, info.mime, decode);
  if (!decodable) {
    return { ok: false, message: CORRUPT_IMAGE_MESSAGE };
  }

  return { ok: true, info };
}

/**
 * Read every ready image in list order into transferable {@link ImagePageInput}
 * payloads for the worker.
 *
 * Uses `Promise.allSettled` so that if multiple files fail to read, the error
 * deterministically names the *first* failing file in list order rather than
 * whichever promise rejected first in wall-clock time.
 *
 * @param items Ordered image list (every item must be `"ready"`).
 * @returns Array of {@link ImagePageInput} ready for worker transfer.
 * @throws {ImageReadError} Naming the first file that could not be read.
 */
export async function readImageInputs(
  items: readonly ImageListItem[],
): Promise<ImagePageInput[]> {
  const reads = items.map(async (item, index): Promise<ImagePageInput> => {
    if (item.status.kind !== "ready") {
      throw new ImageReadError(index);
    }
    try {
      const data = await item.file.arrayBuffer();
      return {
        data,
        mime: item.status.info.mime,
        width: item.status.info.width,
        height: item.status.info.height,
        rotation: item.rotation,
      };
    } catch {
      throw new ImageReadError(index);
    }
  });

  const settled = await Promise.allSettled(reads);
  const failed = settled.find((s) => s.status === "rejected");
  if (failed) throw failed.reason;
  return settled.map(
    (s) => (s as PromiseFulfilledResult<ImagePageInput>).value,
  );
}

/**
 * Format a worker error for display, prefixing the failing filename when the
 * worker identified a specific `imageIndex`.
 *
 * @param result Error response from the worker.
 * @param items Snapshot of the image list when the build started.
 * @returns Human-readable error message.
 */
export function describeBuildError(
  result: Extract<BuildPdfResult, { status: "error" }>,
  items: readonly ImageListItem[],
): string {
  const item =
    result.imageIndex === undefined ? undefined : items[result.imageIndex];
  return item ? `${item.file.name}: ${result.message}` : result.message;
}

/**
 * Safely create a blob preview URL for an image file when running in a browser
 * that supports `URL.createObjectURL`.
 *
 * @param file Image file.
 * @returns Object URL string, or `undefined` in environments without it.
 */
function safeCreateObjectUrl(file: File): string | undefined {
  return typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
    ? URL.createObjectURL(file)
    : undefined;
}

/**
 * Safely revoke a previously created preview URL to prevent memory leaks.
 *
 * @param url Preview URL to revoke, if present.
 */
function safeRevokeObjectUrl(url: string | undefined): void {
  if (
    url &&
    typeof URL !== "undefined" &&
    typeof URL.revokeObjectURL === "function"
  ) {
    URL.revokeObjectURL(url);
  }
}

/**
 * React hook orchestrating image validation, preview URL lifecycle, and
 * Web Worker PDF generation for the Images to PDF tool.
 *
 * State lives in the pure {@link imagesReducer} and is mirrored synchronously
 * in `stateRef` so async validation and build loops always read the latest
 * state rather than stale closure snapshots.
 *
 * @param createClient Factory for the worker client (injected for tests).
 * @param decode Optional image decoder override (injected for tests).
 * @returns Controller with state and actions.
 */
export function useImagesToPdf(
  createClient: () => ImagesToPdfClient = createWorkerImagesToPdfClient,
  decode?: ImageDecoder,
): ImagesToPdfController {
  const [state, setState] = useState<ImagesToPdfState>(INITIAL_IMAGES_STATE);
  const stateRef = useRef(state);
  const clientRef = useRef<ImagesToPdfClient | null>(null);
  const factoryRef = useRef(createClient);
  const decodeRef = useRef(decode);
  const idRef = useRef(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    factoryRef.current = createClient;
  }, [createClient]);

  useEffect(() => {
    decodeRef.current = decode;
  }, [decode]);

  const dispatch = useCallback((action: ImagesToPdfAction) => {
    const next = imagesReducer(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);

  // Terminate worker and revoke all preview object URLs on unmount.
  useEffect(() => {
    aliveRef.current = true;
    const client = factoryRef.current();
    clientRef.current = client;
    return () => {
      aliveRef.current = false;
      clientRef.current?.terminate();
      clientRef.current = null;
      for (const item of stateRef.current.items) {
        safeRevokeObjectUrl(item.previewUrl);
      }
    };
  }, []);

  const runValidationQueue = useCallback(async () => {
    for (;;) {
      const next = nextToValidate(stateRef.current.items);
      if (!next) return;
      dispatch({ type: "validate-started", id: next.id });

      const result = await validateImageFile(next.file, decodeRef.current);
      if (!aliveRef.current) return;

      if (result.ok) {
        dispatch({ type: "validated", id: next.id, info: result.info });
      } else {
        dispatch({
          type: "validation-failed",
          id: next.id,
          message: result.message,
        });
      }
    }
  }, [dispatch]);

  const add = useCallback(
    (files: File[]) => {
      if (files.length === 0 || stateRef.current.outcome.kind === "building") {
        return;
      }
      const items = files.map((file) => ({
        id: `img-${++idRef.current}`,
        file,
        previewUrl: safeCreateObjectUrl(file),
      }));
      dispatch({ type: "add", items });
      void runValidationQueue();
    },
    [dispatch, runValidationQueue],
  );

  const move = useCallback(
    (id: string, offset: -1 | 1) => {
      dispatch({ type: "move", id, offset });
    },
    [dispatch],
  );

  const rotate = useCallback(
    (id: string, delta: 1 | -1) => {
      dispatch({ type: "rotate", id, delta });
    },
    [dispatch],
  );

  const remove = useCallback(
    (id: string) => {
      if (stateRef.current.outcome.kind === "building") return;
      const target = stateRef.current.items.find((i) => i.id === id);
      safeRevokeObjectUrl(target?.previewUrl);
      dispatch({ type: "remove", id });
    },
    [dispatch],
  );

  const clear = useCallback(() => {
    if (stateRef.current.outcome.kind === "building") return;
    for (const item of stateRef.current.items) {
      safeRevokeObjectUrl(item.previewUrl);
    }
    dispatch({ type: "clear" });
  }, [dispatch]);

  const setOptions = useCallback(
    (options: PageLayoutOptions) => {
      dispatch({ type: "set-options", options });
    },
    [dispatch],
  );

  const runBuild = useCallback(async () => {
    const current = stateRef.current;
    if (current.outcome.kind === "building") return;
    if (imagesSummary(current.items).blocker !== undefined) return;

    const client = clientRef.current;
    if (!client) return;

    const snapshot = current.items;
    const options = current.options;
    dispatch({ type: "build-started" });

    let inputs: ImagePageInput[];
    try {
      inputs = await readImageInputs(snapshot);
    } catch (err) {
      if (!aliveRef.current) return;
      const message =
        err instanceof ImageReadError
          ? `${snapshot[err.index].file.name}: ${err.message}`
          : errorMessage(err);
      dispatch({ type: "build-failed", reason: "failed", message });
      return;
    }
    if (!aliveRef.current || clientRef.current !== client) return;

    try {
      const result = await client.build(inputs, options, (progress, stage) => {
        if (!aliveRef.current || clientRef.current !== client) return;
        dispatch({ type: "build-progress", progress, stage });
      });
      if (!aliveRef.current || clientRef.current !== client) return;

      if (result.status === "done") {
        const pdf = new Blob([result.data], { type: "application/pdf" });
        dispatch({
          type: "build-succeeded",
          pdf,
          pageCount: result.pageCount,
        });
      } else {
        // After a WASM trap, replace the crashed worker so the next attempt
        // starts cleanly with fresh linear memory.
        if (result.reason === "crashed") {
          client.terminate();
          clientRef.current = factoryRef.current();
        }
        dispatch({
          type: "build-failed",
          reason: result.reason,
          message: describeBuildError(result, snapshot),
        });
      }
    } catch (err) {
      if (!aliveRef.current || clientRef.current !== client) return;
      dispatch({
        type: "build-failed",
        reason: "failed",
        message: errorMessage(err),
      });
    }
  }, [dispatch]);

  const startBuild = useCallback(() => void runBuild(), [runBuild]);

  return {
    state,
    add,
    move,
    rotate,
    remove,
    clear,
    setOptions,
    build: startBuild,
  };
}
