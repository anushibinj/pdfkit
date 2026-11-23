"use client";

import {
  ArrowDown,
  ArrowUp,
  Download,
  FilePlus2,
  RotateCw,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { FileRow } from "@/components/file-row";
import { StartOverButton } from "@/components/start-over-button";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import { formatBytes } from "@/lib/format";
import { IMAGE_ACCEPT } from "@/lib/image-info";
import { outputPdfName } from "./core/file-names";
import {
  imagesSummary,
  type BuildBlocker,
  type BuildOutcome,
  type ImageItemStatus,
  type ImageListItem,
  type ImagesSummary,
} from "./core/images-state";
import { LayoutOptionsForm } from "./layout-options-form";
import { useImagesToPdf } from "./use-images-to-pdf";

/** Above this combined image size, warn that conversion may use significant RAM. */
export const LARGE_TOTAL_IMAGE_BYTES = 200 * 1024 * 1024;

const BLOCKER_TEXT: Record<BuildBlocker, string> = {
  empty: "Add at least one PNG or JPEG image.",
  validating: "Checking images…",
  invalid: "Remove the images that cannot be used.",
};

/**
 * Predicate for Dropzone accepting PNG and JPEG files by MIME type or extension.
 * Actual file content is verified by magic bytes during validation.
 *
 * @param file Candidate dropped or picked file.
 * @returns `true` if the file looks like a PNG or JPEG.
 */
export function isSupportedImageFile(file: {
  name: string;
  type: string;
}): boolean {
  return (
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    /\.(png|jpe?g)$/i.test(file.name)
  );
}

/**
 * Format an image count with the right singular/plural noun.
 *
 * @param count Number of images/pages.
 * @returns `"1 image"` or `"N images"`.
 */
export function imagesLabel(count: number): string {
  return `${count} ${count === 1 ? "image" : "images"}`;
}

/**
 * Status line next to the Create PDF button: summarizes what will be built or
 * explains why conversion is currently blocked.
 *
 * @param summary Output of {@link imagesSummary}.
 * @returns Human-readable status text.
 */
export function summaryText(summary: ImagesSummary): string {
  if (summary.blocker) return BLOCKER_TEXT[summary.blocker];
  return `${imagesLabel(summary.imageCount)}, ${formatBytes(summary.totalBytes)}`;
}

/**
 * Screen-reader announcement for build lifecycle transitions.
 *
 * @param outcome Current build outcome.
 * @returns Announcement text, or `""` when idle.
 */
export function outcomeAnnouncement(outcome: BuildOutcome): string {
  switch (outcome.kind) {
    case "idle":
      return "";
    case "building":
      return outcome.stage ?? "Creating the PDF…";
    case "done":
      return `PDF ready, ${outcome.pageCount} ${outcome.pageCount === 1 ? "page" : "pages"}, ${formatBytes(outcome.pdf.size)}.`;
    case "error":
      return `Could not create the PDF. ${outcome.message}`;
  }
}

/**
 * Restore keyboard focus onto a moved row's reorder button after DOM reordering.
 *
 * If the button in the same movement direction is now disabled (row reached
 * the top or bottom), focus falls back to the opposite direction button so
 * keyboard users never lose their place in the list.
 *
 * @param container The `<ol>` element holding the rows.
 * @param id Moved item's id.
 * @param offset Movement direction (`-1` up, `+1` down).
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

/** Render the status badge for one image row. */
function StatusFor({ status }: { status: ImageItemStatus }) {
  switch (status.kind) {
    case "queued":
      return <StatusBadge tone="neutral">Waiting</StatusBadge>;
    case "validating":
      return <StatusBadge tone="busy">Checking…</StatusBadge>;
    case "ready":
      return <StatusBadge tone="success">Ready</StatusBadge>;
    case "error":
      return <StatusBadge tone="error">Cannot use</StatusBadge>;
  }
}

/**
 * Images to PDF tool: add PNG or JPEG images, reorder or rotate them, pick
 * paper size, orientation, margin, and scaling, then build and download a PDF
 * locally using PDFium WebAssembly inside a Web Worker.
 */
export default function ImagesToPdfTool() {
  const { state, add, move, rotate, remove, clear, setOptions, build } =
    useImagesToPdf();
  const { items, options, outcome } = state;
  const building = outcome.kind === "building";
  const summary = imagesSummary(items);

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
    if (total > LARGE_TOTAL_IMAGE_BYTES) {
      toast.warning(
        `These images add up to over ${formatBytes(LARGE_TOTAL_IMAGE_BYTES)}. Creating the PDF may be slow or run out of memory.`,
      );
    }
    add(files);
  };

  return (
    <div className="space-y-6">
      {items.length === 0 && (
        <Dropzone
          accept={IMAGE_ACCEPT}
          isAccepted={isSupportedImageFile}
          onFiles={onFiles}
          onRejected={(files) =>
            toast.error(
              `Only PNG and JPEG images are supported. Skipped: ${files.map((f) => f.name).join(", ")}`,
            )
          }
          title="Drop PNG or JPEG images here"
          buttonLabel="Choose images"
          disabled={building}
        />
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {outcomeAnnouncement(outcome)}
      </div>

      {items.length > 0 && (
        <section aria-label="Images to convert" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Images ({items.length})</h2>
            <StartOverButton disabled={building} onClick={clear} />
          </div>

          <ol
            ref={listRef}
            className="marker:text-muted-foreground list-decimal space-y-3 pl-6"
          >
            {items.map((item, index) => (
              <ImageRow
                key={item.id}
                item={item}
                isFirst={index === 0}
                isLast={index === items.length - 1}
                locked={building}
                onMove={(offset) => {
                  movedRef.current = { id: item.id, offset };
                  move(item.id, offset);
                }}
                onRotate={() => rotate(item.id, 1)}
                onRemove={() => remove(item.id)}
              />
            ))}
          </ol>

          <LayoutOptionsForm
            value={options}
            onChange={setOptions}
            disabled={building}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              role="status"
              aria-live="polite"
              className="text-muted-foreground text-sm"
            >
              {building
                ? (outcome.stage ?? "Creating PDF…")
                : summaryText(summary)}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                className="min-h-11"
                disabled={building || summary.blocker !== undefined}
                onClick={build}
              >
                <FilePlus2 aria-hidden="true" />{" "}
                {building ? "Creating PDF…" : "Create PDF"}
              </Button>
              {outcome.kind === "done" && (
                <Button
                  className="min-h-11"
                  onClick={() =>
                    downloadBlob(
                      outcome.pdf,
                      outputPdfName(items.map((i) => i.file.name)),
                    )
                  }
                >
                  <Download aria-hidden="true" /> Download PDF (
                  {formatBytes(outcome.pdf.size)})
                </Button>
              )}
            </div>
          </div>

          {outcome.kind === "error" && (
            <Alert variant="destructive">
              <AlertTitle>
                {outcome.reason === "out-of-memory"
                  ? "Out of memory"
                  : "Could not create the PDF"}
              </AlertTitle>
              <AlertDescription>{outcome.message}</AlertDescription>
            </Alert>
          )}
        </section>
      )}
    </div>
  );
}

interface ImageRowProps {
  item: ImageListItem;
  isFirst: boolean;
  isLast: boolean;
  locked: boolean;
  onMove(offset: -1 | 1): void;
  onRotate(): void;
  onRemove(): void;
}

/** One image entry in the ordered list, with thumbnail, metadata, and actions. */
function ImageRow({
  item,
  isFirst,
  isLast,
  locked,
  onMove,
  onRotate,
  onRemove,
}: ImageRowProps) {
  const { file, status, rotation, previewUrl } = item;
  const size = formatBytes(file.size);
  const rotationLabel = rotation === 0 ? "" : ` · ${rotation * 90}°`;
  const sizeLabel =
    status.kind === "ready"
      ? `${size} · ${status.info.width} × ${status.info.height} px · ${status.info.mime === "image/png" ? "PNG" : "JPEG"}${rotationLabel}`
      : size;

  return (
    <FileRow
      name={file.name}
      sizeLabel={sizeLabel}
      status={
        <div className="flex items-center gap-2">
          {previewUrl && status.kind === "ready" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              aria-hidden="true"
              className="border-border size-10 shrink-0 rounded border object-contain"
              style={{
                transform:
                  rotation === 0 ? undefined : `rotate(${rotation * 90}deg)`,
              }}
            />
          )}
          <StatusFor status={status} />
        </div>
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={`Rotate ${file.name} 90 degrees clockwise`}
            disabled={locked || status.kind !== "ready"}
            onClick={onRotate}
          >
            <RotateCw aria-hidden="true" />
          </Button>
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
            <AlertTitle>This image cannot be used</AlertTitle>
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        ) : undefined
      }
    />
  );
}
