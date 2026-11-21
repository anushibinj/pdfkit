"use client";

import {
  ArrowDown,
  ArrowUp,
  Combine,
  Download,
  KeyRound,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { FileRow } from "@/components/file-row";
import { PasswordDialog } from "@/components/password-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import { formatBytes, isPdfFile, suffixedPdfName } from "@/lib/format";
import {
  mergeSummary,
  type FileStatus,
  type MergeBlocker,
  type MergeItem,
  type MergeOutcome,
  type MergeSummary,
} from "./merge-state";
import { useMergePdfs } from "./use-merge-pdfs";

/** Above this combined size, merging may be slow or run out of memory. */
export const LARGE_TOTAL_BYTES = 500 * 1024 * 1024;

const BLOCKER_TEXT: Record<MergeBlocker, string> = {
  "too-few": "Add at least two PDFs to merge.",
  checking: "Checking files…",
  locked: "Enter the password of each locked file, or remove it.",
  unreadable: "Remove the files that cannot be opened.",
};

/**
 * "1 page" / "12 pages".
 *
 * @param count Number of pages.
 * @returns The count with the right noun.
 */
export function pagesLabel(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

/**
 * The line next to the Merge button: what will be merged, or why it cannot be.
 *
 * @param summary From `mergeSummary`.
 * @returns The text to show.
 */
export function summaryText(summary: MergeSummary): string {
  if (summary.blocker) return BLOCKER_TEXT[summary.blocker];
  return `${summary.fileCount} files, ${pagesLabel(summary.pageCount)}, ${formatBytes(summary.totalBytes)}`;
}

/**
 * What screen readers hear when the merge starts, finishes or fails.
 *
 * @param outcome The merge's state.
 * @returns The announcement, or "" when there is nothing to say.
 */
export function outcomeAnnouncement(outcome: MergeOutcome): string {
  switch (outcome.kind) {
    case "idle":
      return "";
    case "merging":
      return "Merging the PDFs…";
    case "done":
      return `Merged PDF ready, ${pagesLabel(outcome.pageCount)}, ${formatBytes(outcome.pdf.size)}.`;
    case "error":
      return `Could not merge the PDFs. ${outcome.message}`;
  }
}

/**
 * Put focus back on a row's move button after the row moved.
 *
 * Reordering a list can move the focused row's DOM node, and browsers drop
 * focus from a node that is moved; a button that just became disabled (the
 * row reached the top or bottom) cannot keep useful focus either. Without
 * this, a keyboard user pressing "Move down" repeatedly would lose their
 * place after every press. So: focus the same direction's button on the
 * moved row, or the opposite one if that is now disabled.
 *
 * @param container The list element.
 * @param id The moved item's id.
 * @param offset The direction it moved: -1 up, +1 down.
 */
export function focusMoveButton(
  container: HTMLElement | null,
  id: string,
  offset: -1 | 1,
): void {
  const button = (direction: -1 | 1) =>
    container?.querySelector<HTMLButtonElement>(
      `button[data-move-id="${id}"][data-move-offset="${direction}"]`,
    );
  const same = button(offset);
  const target = same && !same.disabled ? same : button(offset === 1 ? -1 : 1);
  if (target && !target.disabled) target.focus();
}

/** The badge on one file's row. */
function StatusFor({ status }: { status: FileStatus }) {
  switch (status.kind) {
    case "queued":
      return <StatusBadge tone="neutral">Waiting</StatusBadge>;
    case "checking":
      return <StatusBadge tone="busy">Checking…</StatusBadge>;
    case "ready":
      return <StatusBadge tone="success">Ready</StatusBadge>;
    case "needs-password":
      return <StatusBadge tone="warning">Password needed</StatusBadge>;
    case "error":
      return <StatusBadge tone="error">Cannot open</StatusBadge>;
  }
}

/**
 * Merge PDFs tool: add PDFs, put them in order, unlock the locked ones, then
 * merge and download. All work happens in a Web Worker.
 */
export default function MergeTool() {
  const {
    state,
    add,
    submitPassword,
    dismissPassword,
    reopenPassword,
    move,
    remove,
    clear,
    merge,
  } = useMergePdfs();
  const { items, outcome } = state;
  const merging = outcome.kind === "merging";
  const summary = mergeSummary(items);

  // Focus follows a moved row (see focusMoveButton).
  const listRef = useRef<HTMLOListElement>(null);
  const movedRef = useRef<{ id: string; offset: -1 | 1 } | null>(null);
  useEffect(() => {
    const moved = movedRef.current;
    if (!moved) return;
    movedRef.current = null;
    focusMoveButton(listRef.current, moved.id, moved.offset);
  }, [items]);

  const onFiles = (files: File[]) => {
    const total =
      summary.totalBytes + files.reduce((sum, f) => sum + f.size, 0);
    if (total > LARGE_TOTAL_BYTES) {
      toast.warning(
        `These files add up to over ${formatBytes(LARGE_TOTAL_BYTES)}. Merging may be slow or run out of memory.`,
      );
    }
    add(files);
  };

  // The first file that still needs a password and was not skipped.
  const promptItem = items.find(
    (i) => i.status.kind === "needs-password" && !i.status.dismissed,
  );

  return (
    <div className="space-y-6">
      <Alert
        role="note"
        className="border-yellow-300 bg-yellow-50 text-yellow-950 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-100"
      >
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>Beta: what is and is not kept</AlertTitle>
        <AlertDescription className="text-yellow-900 dark:text-yellow-200">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Every page is copied as it is: text, images, links, comments and
              form fields stay, and nothing is re-compressed.
            </li>
            <li>
              Bookmarks (the outline) and document properties such as the title
              are not carried over.
            </li>
            <li>
              The merged file has no password, and digital signatures in the
              original files are no longer valid in it.
            </li>
          </ul>
        </AlertDescription>
      </Alert>

      <Dropzone
        accept=".pdf,application/pdf"
        isAccepted={isPdfFile}
        onFiles={onFiles}
        onRejected={(files) =>
          toast.error(
            `Only PDF files are supported. Skipped: ${files.map((f) => f.name).join(", ")}`,
          )
        }
        disabled={merging}
      />

      <div role="status" aria-live="polite" className="sr-only">
        {outcomeAnnouncement(outcome)}
      </div>

      {items.length > 0 && (
        <section aria-label="Files to merge" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Files ({items.length})</h2>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={merging}
              onClick={clear}
            >
              <Trash2 aria-hidden="true" /> Clear all
            </Button>
          </div>

          {/* An ordered list: the order is the merge order, and screen
              readers announce each file's position. */}
          <ol
            ref={listRef}
            className="marker:text-muted-foreground list-decimal space-y-3 pl-6"
          >
            {items.map((item, index) => (
              <MergeRow
                key={item.id}
                item={item}
                isFirst={index === 0}
                isLast={index === items.length - 1}
                locked={merging}
                onMove={(offset) => {
                  movedRef.current = { id: item.id, offset };
                  move(item.id, offset);
                }}
                onRemove={() => remove(item.id)}
                onReopenPassword={() => reopenPassword(item.id)}
              />
            ))}
          </ol>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              role="status"
              aria-live="polite"
              className="text-muted-foreground text-sm"
            >
              {summaryText(summary)}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                className="min-h-11"
                disabled={merging || summary.blocker !== undefined}
                onClick={merge}
              >
                <Combine aria-hidden="true" />{" "}
                {merging ? "Merging…" : "Merge PDFs"}
              </Button>
              {outcome.kind === "done" && (
                <Button
                  className="min-h-11"
                  onClick={() =>
                    downloadBlob(
                      outcome.pdf,
                      suffixedPdfName(items[0].file.name, "-merged"),
                    )
                  }
                >
                  <Download aria-hidden="true" /> Download merged PDF (
                  {formatBytes(outcome.pdf.size)})
                </Button>
              )}
            </div>
          </div>

          {outcome.kind === "done" && outcome.warnings && (
            <p className="text-muted-foreground text-sm">
              qpdf finished with a warning: {outcome.warnings}
            </p>
          )}

          {outcome.kind === "error" && (
            <Alert variant="destructive">
              <AlertTitle>
                {outcome.reason === "out-of-memory"
                  ? "Out of memory"
                  : "Could not merge the PDFs"}
              </AlertTitle>
              <AlertDescription>{outcome.message}</AlertDescription>
            </Alert>
          )}
        </section>
      )}

      {promptItem && promptItem.status.kind === "needs-password" && (
        <PasswordDialog
          key={promptItem.id}
          fileName={promptItem.file.name}
          wrong={promptItem.status.wrong}
          onSubmit={(password) => submitPassword(promptItem.id, password)}
          onCancel={() => dismissPassword(promptItem.id)}
        />
      )}
    </div>
  );
}

interface MergeRowProps {
  item: MergeItem;
  isFirst: boolean;
  isLast: boolean;
  /** True while merging: nothing in the list may change. */
  locked: boolean;
  onMove(offset: -1 | 1): void;
  onRemove(): void;
  onReopenPassword(): void;
}

/** One file in the merge list, with its reorder and remove buttons. */
function MergeRow({
  item,
  isFirst,
  isLast,
  locked,
  onMove,
  onRemove,
  onReopenPassword,
}: MergeRowProps) {
  const { file, status } = item;
  const size = formatBytes(file.size);
  return (
    <FileRow
      name={file.name}
      sizeLabel={
        status.kind === "ready"
          ? `${size} · ${pagesLabel(status.pageCount)}`
          : size
      }
      status={<StatusFor status={status} />}
      actions={
        <>
          {status.kind === "needs-password" && status.dismissed && (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={locked}
              onClick={onReopenPassword}
            >
              <KeyRound aria-hidden="true" /> Enter password
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={`Move ${file.name} up`}
            data-move-id={item.id}
            data-move-offset={-1}
            disabled={locked || isFirst}
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={`Move ${file.name} down`}
            data-move-id={item.id}
            data-move-offset={1}
            disabled={locked || isLast}
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={`Remove ${file.name}`}
            disabled={locked}
            onClick={onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        </>
      }
      detail={
        status.kind === "error" ? (
          <Alert variant="destructive">
            <AlertTitle>
              {status.reason === "out-of-memory"
                ? "Out of memory"
                : "This file cannot be merged"}
            </AlertTitle>
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        ) : undefined
      }
    />
  );
}
