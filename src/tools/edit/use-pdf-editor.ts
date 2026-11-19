"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from "react";
import { errorMessage } from "@/lib/errors";
import {
  EMPTY_EDITOR_STATE,
  editorReducer,
  type EditorAction,
  type EditorState,
} from "./core/editor-state";
import type { ImageAsset, QuarterTurns } from "./core/model";
import { buildSavePlan } from "./core/save-plan";
import {
  INITIAL_DOCUMENT_STATUS,
  documentReducer,
  type DocumentStatus,
} from "./document-state";
import { EditorEngine } from "./editor-engine";
import type { RenderResult, SaveResult } from "./messages";
import { useImageAssets } from "./use-image-assets";

/** Everything the editor UI needs, in one place. */
export interface PdfEditor {
  status: DocumentStatus;
  editor: EditorState;
  dispatch: Dispatch<EditorAction>;
  images: {
    assets: ReadonlyMap<string, ImageAsset>;
    urls: ReadonlyMap<string, string>;
  };
  /** True while the edited file is being produced. */
  saving: boolean;
  /** Read and open a PDF the user picked. */
  openFile(file: File): Promise<void>;
  /** Retry opening the pending file with a password. */
  submitPassword(password: string): Promise<void>;
  /** Close the file (or give up on a password) and start over. */
  close(): void;
  /** Store an image so image objects can use it. */
  addImage(asset: ImageAsset): void;
  /** Render a page of the original file (stable identity across renders). */
  renderPage(
    pageIndex: number,
    rotation: QuarterTurns,
    width: number,
  ): Promise<RenderResult>;
  /** Produce the edited file from the current document. */
  save(): Promise<SaveResult>;
}

/** Result for requests made after the component unmounted. */
const UNMOUNTED = {
  status: "error",
  reason: "failed",
  message: "The editor was closed.",
} as const;

/**
 * Own the PDF engine and all editor state for the tool page.
 *
 * It ties together four independent pieces, each tested on its own:
 * - `EditorEngine` (talks to the worker, survives crashes);
 * - `documentReducer` (empty, opening, password, ready, failed);
 * - `editorReducer` (pages, objects, selection, undo history);
 * - `useImageAssets` (added images and their preview URLs).
 *
 * Opening uses a sequence number (`openSeq`): each attempt takes the next
 * number, and a result is applied only if no newer attempt (or close)
 * happened while it was in flight. Without that, a slow first file could
 * replace a second one the user picked afterwards.
 *
 * @param createEngine Factory for the engine (injected for tests).
 * @returns The editor's state and actions.
 */
export function usePdfEditor(
  createEngine: () => EditorEngine = () => new EditorEngine(),
): PdfEditor {
  const [status, dispatchStatus] = useReducer(
    documentReducer,
    INITIAL_DOCUMENT_STATUS,
  );
  const [editor, dispatch] = useReducer(editorReducer, EMPTY_EDITOR_STATE);
  const [saving, setSaving] = useState(false);
  const images = useImageAssets();
  const { clear: clearImages } = images;
  const engineRef = useRef<EditorEngine | null>(null);
  const factoryRef = useRef(createEngine);
  const pendingRef = useRef<{ name: string; data: ArrayBuffer } | null>(null);
  const openSeq = useRef(0);

  useEffect(() => {
    const engine = factoryRef.current();
    engineRef.current = engine;
    return () => {
      // Invalidate anything in flight, then stop the worker. openSeq is a
      // plain counter, not a DOM ref, so reading its latest value is intended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      openSeq.current++;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  /** Open the pending file with `password` and apply the answer. */
  const openPending = useCallback(
    async (password: string) => {
      const pending = pendingRef.current;
      const engine = engineRef.current;
      if (!pending || !engine) return;
      const seq = ++openSeq.current;
      dispatchStatus({ type: "opening", fileName: pending.name });
      const result = await engine.open(pending.data, password);
      if (seq !== openSeq.current) return;
      if (result.status === "opened") {
        pendingRef.current = null;
        clearImages();
        dispatch({ type: "load", pageCount: result.pages.length });
      }
      dispatchStatus({ type: "opened", result });
    },
    [clearImages],
  );

  const openFile = useCallback(
    async (file: File) => {
      let data: ArrayBuffer;
      try {
        data = await file.arrayBuffer();
      } catch (err) {
        dispatchStatus({
          type: "read-failed",
          fileName: file.name,
          message: errorMessage(err),
        });
        return;
      }
      pendingRef.current = { name: file.name, data };
      await openPending("");
    },
    [openPending],
  );

  const submitPassword = useCallback(
    (password: string) => openPending(password),
    [openPending],
  );

  const close = useCallback(() => {
    openSeq.current++;
    pendingRef.current = null;
    void engineRef.current?.close();
    clearImages();
    dispatch({ type: "load", pageCount: 0 });
    dispatchStatus({ type: "reset" });
  }, [clearImages]);

  const renderPage = useCallback(
    (
      pageIndex: number,
      rotation: QuarterTurns,
      width: number,
    ): Promise<RenderResult> =>
      engineRef.current?.render(pageIndex, rotation, width) ??
      Promise.resolve(UNMOUNTED),
    [],
  );

  const { assets } = images;
  const document = editor.history.present;
  const save = useCallback(async (): Promise<SaveResult> => {
    const engine = engineRef.current;
    if (!engine) return UNMOUNTED;
    setSaving(true);
    try {
      return await engine.save(buildSavePlan(document, assets));
    } catch (err) {
      return { status: "error", reason: "failed", message: errorMessage(err) };
    } finally {
      setSaving(false);
    }
  }, [document, assets]);

  return {
    status,
    editor,
    dispatch,
    images: { assets: images.assets, urls: images.urls },
    saving,
    openFile,
    submitPassword,
    close,
    addImage: images.add,
    renderPage,
    save,
  };
}
