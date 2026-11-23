"use client";

import { TriangleAlert } from "lucide-react";
import { useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import { isPdfFile } from "@/lib/format";
import { DiscardDialog } from "@/components/discard-dialog";
import { PasswordPrompt } from "@/components/password-prompt";
import { useUnsavedWarning } from "@/lib/use-unsaved-warning";
import { announcementFor, pageCountLabel } from "./announcements";
import type { BoardPage } from "./core/board";
import {
  ARRANGE_MINIMUM,
  arrangeScope,
  boardReducer,
  type ArrangeKind,
  type BoardAction,
} from "./core/board-state";
import { outputFileName } from "./core/file-names";
import { DEFAULT_ZOOM, stepZoom } from "./core/zoom";
import { BoardToolbar } from "./board-toolbar";
import { PageBoard } from "./page-board";
import { SourceLegend } from "./source-legend";
import { useBoardShortcuts } from "./use-board-shortcuts";
import { useOrganizer } from "./use-organizer";

const ARRANGE_KINDS: readonly ArrangeKind[] = [
  "interleave",
  "reverse",
  "turn-landscape",
];

/** Tell the user which dropped files were skipped for not being PDFs. */
function rejectFiles(files: readonly File[]): void {
  toast.error(
    `Only PDF files are supported. Skipped: ${files.map((f) => f.name).join(", ")}`,
  );
}

/**
 * Page organizer: drop one or more PDFs, and their pages appear on one
 * board, coloured by file. Reorder (drag, or Ctrl/Cmd + arrows), rotate,
 * duplicate, delete, insert blank pages, interleave a double-sided scan,
 * reverse, turn landscape pages upright, undo and redo; then download one
 * new PDF. Everything runs in this tab; PDFium runs in a Web Worker.
 */
export default function OrganizeTool() {
  const org = useOrganizer({ notify: (message) => toast.error(message) });
  const { state, dispatch } = org;
  const pages = state.history.present;
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const [savedPages, setSavedPages] = useState<readonly BoardPage[] | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");

  // The board stays up once a file was added, even if undo empties it, so
  // redo is still within reach.
  const hasBoard = state.sources.length > 0;
  // Unsaved: something was done since the files were opened, and it is not
  // exactly what was last downloaded.
  const dirty = state.history.past.length > 0 && pages !== savedPages;
  useUnsavedWarning(dirty);
  const dialogOpen = org.passwordRequest !== null || confirmStartOver;
  const selectedCount = state.selection.keys.size;

  /** Run a board action and announce its outcome. */
  const perform = (action: BoardAction) => {
    const message = announcementFor(action, state, boardReducer(state, action));
    dispatch(action);
    if (message) setAnnouncement(message);
  };

  useBoardShortcuts(hasBoard && !org.saving && !dialogOpen, {
    undo: () => {
      perform({ type: "undo" });
      return true;
    },
    redo: () => {
      perform({ type: "redo" });
      return true;
    },
    remove: () => {
      if (selectedCount === 0) return false;
      perform({ type: "delete" });
      return true;
    },
  });

  const download = async () => {
    const saving = pages;
    const result = await org.save();
    if (result.status === "saved") {
      const name = outputFileName(saving, state.sources);
      downloadBlob(new Blob([result.data], { type: "application/pdf" }), name);
      setSavedPages(saving);
      setAnnouncement(`Saved ${name}.`);
    } else {
      toast.error(result.message);
      setAnnouncement(`Could not save the PDF. ${result.message}`);
    }
  };

  const startOver = () => {
    setConfirmStartOver(false);
    setSavedPages(null);
    org.clear();
  };

  const addFiles = (files: readonly File[]) => {
    const pdfs = files.filter(isPdfFile);
    const others = files.filter((f) => !isPdfFile(f));
    if (others.length > 0) rejectFiles(others);
    if (pdfs.length > 0) org.addFiles(pdfs);
  };

  // Files dropped anywhere on the board are added, like with "Add PDFs".
  // Page drags use pointer events, not HTML drag and drop, so they never
  // reach these handlers.
  const boardDrop = {
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      if (e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      if (!org.saving) addFiles(Array.from(e.dataTransfer.files));
    },
  };

  return (
    <div className="space-y-6">
      <Alert
        role="note"
        className="border-yellow-300 bg-yellow-50 text-yellow-950 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-100"
      >
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>Beta: what the organizer can and cannot do yet</AlertTitle>
        <AlertDescription className="text-yellow-900 dark:text-yellow-200">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Add several PDFs: their pages appear on one board, numbered and
              coloured by file. Drag pages (or press Ctrl or ⌘ with the arrow
              keys) to reorder them; Ctrl, ⌘ or Shift with a click selects
              several.
            </li>
            <li>
              Rotate, duplicate or delete pages, insert blank pages, reverse the
              order, or interleave a double-sided scan (fronts, then backs in
              reverse). Rotating only turns the page: text stays text.
            </li>
            <li>
              The download is a new PDF made of the pages. Bookmarks, form
              fields and document properties are not carried over, links between
              pages may stop working, digital signatures are not kept, and files
              opened with a password are saved without one.
            </li>
          </ul>
        </AlertDescription>
      </Alert>

      {!hasBoard && !org.opening && (
        <Dropzone
          accept=".pdf,application/pdf"
          isAccepted={isPdfFile}
          onFiles={addFiles}
          onRejected={rejectFiles}
          title="Drop PDFs here"
          buttonLabel="Choose PDFs"
        />
      )}

      {!hasBoard && org.opening && (
        <p
          role="status"
          className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm"
        >
          Opening {org.opening}… The first time, the PDF engine (about 5 MB) is
          downloaded, so it takes a little longer.
        </p>
      )}

      {hasBoard && (
        <section aria-label="Page board" className="space-y-4" {...boardDrop}>
          {/* Sticky from md up only: on a phone the toolbar wraps into
              several rows and, kept on screen, would hide most of the board. */}
          <div className="bg-background/95 -mx-4 space-y-2 border-b px-4 py-3 backdrop-blur md:sticky md:top-[calc(4rem+env(safe-area-inset-top))] md:z-30">
            <BoardToolbar
              pageCount={pages.length}
              selectedCount={selectedCount}
              canUndo={state.history.past.length > 0}
              canRedo={state.history.future.length > 0}
              arrangeOnSelection={
                Object.fromEntries(
                  ARRANGE_KINDS.map((kind) => [
                    kind,
                    arrangeScope(pages, state.selection, ARRANGE_MINIMUM[kind])
                      .selectionOnly,
                  ]),
                ) as Record<ArrangeKind, boolean>
              }
              zoom={zoom}
              saving={org.saving}
              onAction={perform}
              onAddFiles={addFiles}
              onZoom={(delta) => setZoom((z) => stepZoom(z, delta))}
              onDownload={() => void download()}
              onStartOver={() =>
                dirty ? setConfirmStartOver(true) : startOver()
              }
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <p className="text-muted-foreground" aria-live="polite">
                {selectedCount > 0
                  ? `${selectedCount} of ${pageCountLabel(pages.length)} selected`
                  : pageCountLabel(pages.length)}
                {org.opening && ` · Opening ${org.opening}…`}
              </p>
              <Button
                variant="link"
                className="h-auto min-h-9 p-0"
                disabled={org.saving || pages.length === 0}
                onClick={() => dispatch({ type: "select-all" })}
              >
                Select all
              </Button>
              <Button
                variant="link"
                className="h-auto min-h-9 p-0"
                disabled={org.saving || selectedCount === 0}
                onClick={() => dispatch({ type: "select-none" })}
              >
                Select none
              </Button>
            </div>
          </div>

          <SourceLegend
            sources={state.sources}
            pages={pages}
            disabled={org.saving}
            onSelectSource={(sourceId) =>
              dispatch({ type: "select-source", sourceId })
            }
          />

          {pages.length > 0 ? (
            <PageBoard
              state={state}
              dispatch={dispatch}
              render={org.render}
              zoom={zoom}
              disabled={org.saving}
              onAnnounce={setAnnouncement}
            />
          ) : (
            <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
              The board is empty. Undo, or add PDFs.
            </p>
          )}
        </section>
      )}

      {org.passwordRequest && (
        <PasswordPrompt
          key={org.passwordRequest.fileName}
          fileName={org.passwordRequest.fileName}
          wrong={org.passwordRequest.wrong}
          busy={org.passwordRequest.checking}
          note="The organized file is a new PDF and is saved without a password."
          cancelLabel="Skip this file"
          onSubmit={(password) => org.answerPassword(password)}
          onCancel={() => org.answerPassword(null)}
        />
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <DiscardDialog
        open={confirmStartOver}
        title="Start over?"
        description="The board has changes that have not been downloaded yet. Starting over closes every file."
        keepLabel="Keep the board"
        discardLabel="Start over"
        onKeep={() => setConfirmStartOver(false)}
        onDiscard={startOver}
      />
    </div>
  );
}
