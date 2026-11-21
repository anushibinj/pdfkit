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
import type { QuarterTurns } from "@/tools/edit/core/model";
import { MAX_BOARD_PAGES } from "./core/board";
import {
  EMPTY_BOARD_STATE,
  boardReducer,
  type BoardAction,
  type BoardState,
} from "./core/board-state";
import { buildOutputPlan } from "./core/output-plan";
import type { RenderResult, SaveResult } from "./messages";
import { OpenQueue } from "./open-queue";
import { OrganizeEngine } from "./organize-engine";

/** Largest single PDF accepted (the editor's limit too). */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
/**
 * Largest total of all open PDFs. Each file is held twice (in the engine
 * and in the page, for crash recovery) and saving builds a file about as
 * large as all of them together, so this keeps a board within the memory a
 * browser tab can usually get.
 */
export const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

/** A file waiting for its password. */
export interface PasswordRequest {
  fileName: string;
  /** The last password tried was refused. */
  wrong: boolean;
  /** A password is being checked. */
  checking: boolean;
}

/** Everything the organizer page needs, in one place. */
export interface Organizer {
  state: BoardState;
  dispatch: Dispatch<BoardAction>;
  /** The file being opened, or `null`. */
  opening: string | null;
  /** The password prompt to show, or `null`. */
  passwordRequest: PasswordRequest | null;
  /** True while the organized file is being produced. */
  saving: boolean;
  /** Open PDFs and add their pages to the board, one file at a time. */
  addFiles(files: readonly File[]): void;
  /** Answer the password prompt; `null` skips the file. */
  answerPassword(password: string | null): void;
  /** Close every file and empty the board. */
  clear(): void;
  /** Render a page of an open file (stable identity). */
  render(
    sourceId: string,
    pageIndex: number,
    rotation: QuarterTurns,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderResult>;
  /** Build the organized file from the board. */
  save(): Promise<SaveResult>;
}

/** Options for {@link useOrganizer}. */
export interface UseOrganizerOptions {
  /** Factory for the engine (injected for tests). */
  createEngine?: () => OrganizeEngine;
  /** Shows a message to the user (a toast in the app). */
  notify?: (message: string) => void;
}

/** Result for requests made after the component unmounted. */
const UNMOUNTED = {
  status: "error",
  reason: "failed",
  message: "The organizer was closed.",
} as const;

/**
 * Own the PDF engine, the board state and the file queue for the page.
 *
 * It wires together pieces that are each tested on their own:
 * - `OrganizeEngine` talks to the worker and survives crashes;
 * - `boardReducer` owns the pages, the selection and undo;
 * - `OpenQueue` opens added files one by one and asks for passwords.
 *
 * The queue's callbacks outlive renders, so they read the latest values
 * through refs. One subtlety: the page limit is checked in `onOpened`
 * against `pageCount`, a ref that is re-synced to the board after every
 * render *and* bumped immediately when a file is accepted. Without the
 * bump, two files accepted before React re-renders would each be checked
 * against the old count.
 *
 * @param options Engine factory and notifier.
 * @returns The organizer's state and actions.
 */
export function useOrganizer(options: UseOrganizerOptions = {}): Organizer {
  const [state, dispatch] = useReducer(boardReducer, EMPTY_BOARD_STATE);
  const [opening, setOpening] = useState<string | null>(null);
  const [passwordRequest, setPasswordRequest] =
    useState<PasswordRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const engineRef = useRef<OrganizeEngine | null>(null);
  const queueRef = useRef<OpenQueue | null>(null);
  const answerRef = useRef<((password: string | null) => void) | null>(null);
  const optionsRef = useRef(options);
  const pageCount = useRef(0);
  const colorSlot = useRef(0);
  const idSeq = useRef(0);

  useEffect(() => {
    optionsRef.current = options;
    pageCount.current = state.history.present.length;
  });

  useEffect(() => {
    const engine = (
      optionsRef.current.createEngine ?? (() => new OrganizeEngine())
    )();
    engineRef.current = engine;
    const notify = (message: string) => optionsRef.current.notify?.(message);
    const queue = new OpenQueue(
      {
        read: (file) => file.arrayBuffer(),
        open: async (id, data, password) => {
          const result = await engine.open(id, data, password);
          // Anything but another password question ends the prompt.
          if (
            result.status !== "password-required" &&
            result.status !== "wrong-password"
          )
            setPasswordRequest(null);
          return result;
        },
        askPassword: (fileName, wrong) =>
          new Promise((resolve) => {
            answerRef.current = resolve;
            setPasswordRequest({ fileName, wrong, checking: false });
          }),
        onOpened: (file) => {
          if (pageCount.current + file.pages.length > MAX_BOARD_PAGES) {
            notify(
              `${file.name} was not added: the board holds at most ${MAX_BOARD_PAGES} pages.`,
            );
            return false;
          }
          pageCount.current += file.pages.length;
          dispatch({
            type: "add-source",
            source: {
              id: file.id,
              name: file.name,
              pages: file.pages,
              colorIndex: colorSlot.current++,
              passwordProtected: file.passwordProtected,
            },
          });
          return true;
        },
        close: (id) => void engine.close(id),
        onFailed: (fileName, message) =>
          notify(`Could not open ${fileName}. ${message}`),
        onBusy: setOpening,
        newId: () => `s${++idSeq.current}`,
      },
      { maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES },
    );
    queueRef.current = queue;
    return () => {
      queue.cancel();
      answerRef.current?.(null);
      answerRef.current = null;
      engine.dispose();
      engineRef.current = null;
      queueRef.current = null;
    };
  }, []);

  const addFiles = useCallback((files: readonly File[]) => {
    void queueRef.current?.add(files);
  }, []);

  const answerPassword = useCallback((password: string | null) => {
    const answer = answerRef.current;
    answerRef.current = null;
    // Keep the prompt up (marked busy) while a password is checked, so a
    // wrong one re-shows the same dialog instead of flashing a new one.
    setPasswordRequest((request) =>
      password === null || !request ? null : { ...request, checking: true },
    );
    answer?.(password);
  }, []);

  const clear = useCallback(() => {
    queueRef.current?.cancel();
    answerRef.current?.(null);
    answerRef.current = null;
    setPasswordRequest(null);
    colorSlot.current = 0;
    pageCount.current = 0;
    void engineRef.current?.close();
    dispatch({ type: "clear" });
  }, []);

  const render = useCallback(
    (
      sourceId: string,
      pageIndex: number,
      rotation: QuarterTurns,
      width: number,
      signal?: AbortSignal,
    ): Promise<RenderResult> =>
      engineRef.current?.render(sourceId, pageIndex, rotation, width, signal) ??
      Promise.resolve(UNMOUNTED),
    [],
  );

  const pages = state.history.present;
  const save = useCallback(async (): Promise<SaveResult> => {
    const engine = engineRef.current;
    if (!engine) return UNMOUNTED;
    setSaving(true);
    try {
      return await engine.save(buildOutputPlan(pages));
    } catch (err) {
      return { status: "error", reason: "failed", message: errorMessage(err) };
    } finally {
      setSaving(false);
    }
  }, [pages]);

  return {
    state,
    dispatch,
    opening,
    passwordRequest,
    saving,
    addFiles,
    answerPassword,
    clear,
    render,
    save,
  };
}
