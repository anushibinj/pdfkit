"use client";

import { Download, FileArchive, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { downloadBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { createStoredZip } from "@/lib/zip/stored-zip";
import { BlobImage } from "./blob-image";
import { archiveName, outputFileNames } from "./core/file-names";
import type { OutputFile, RunState } from "./core/run-state";
import type { ExtractionMethod } from "./engine/extraction-strategies";

/** How an extracted image's source is described to the user. */
const METHOD_LABELS: Record<ExtractionMethod, string> = {
  "original-jpeg": "Original JPEG",
  "decoded-with-alpha": "PNG",
  decoded: "PNG",
};

/**
 * "Page 3" or "Pages 1, 4, 9", for the pages a file comes from.
 *
 * @param pages 1-based page numbers.
 * @returns The label.
 */
export function pagesLabel(pages: readonly number[]): string {
  return `${pages.length === 1 ? "Page" : "Pages"} ${pages.join(", ")}`;
}

/**
 * The line describing a file: size in pixels, then format details.
 *
 * @param file The file.
 * @returns For example "1240 × 1754 px · 150 DPI · PNG · 1.2 MB".
 */
export function fileDetails(file: OutputFile): string {
  const parts = [`${file.width} × ${file.height} px`];
  if (file.dpi !== undefined) parts.push(`${file.dpi} DPI`);
  parts.push(
    file.method
      ? METHOD_LABELS[file.method]
      : file.mimeType === "image/jpeg"
        ? "JPEG"
        : "PNG",
  );
  parts.push(formatBytes(file.blob.size));
  return parts.join(" · ");
}

/**
 * Images up to this many pixels on their longer side are enlarged to fill
 * the preview box (176 px tall), so icons and small logos can be seen.
 */
export const SMALL_PREVIEW_PX = 160;

/**
 * Classes for a file's preview image.
 *
 * Large images (rendered pages, photos) are shrunk to fit and keep smooth
 * scaling. Small ones are enlarged to fill the box with
 * `image-rendering: pixelated`, so every pixel stays a crisp square instead
 * of a blur, which shows what the file really contains.
 *
 * @param file The file.
 * @returns Tailwind classes for the `<img>`.
 */
export function previewClass(
  file: Pick<OutputFile, "width" | "height">,
): string {
  return Math.max(file.width, file.height) <= SMALL_PREVIEW_PX
    ? "h-full w-full object-contain [image-rendering:pixelated]"
    : "max-h-full max-w-full object-contain shadow-sm";
}

interface RunResultsProps {
  run: Exclude<RunState, { kind: "idle" }>;
  /** From `baseNameOf`: the PDF's name, for the file names. */
  baseName: string;
  pageCount: number;
  /** Shown if building the ZIP fails. */
  onError(message: string): void;
}

/**
 * Progress and results of a run: one card per produced file with its own
 * download, a ZIP of everything, and notes about pages rendered at a lower
 * resolution and images that could not be extracted.
 *
 * File names come from the whole list (`outputFileNames`), so image numbers
 * are padded to the final count; downloads are offered once the run ends.
 *
 * @param props The run and naming details.
 * @returns The results section.
 */
export function RunResults({
  run,
  baseName,
  pageCount,
  onError,
}: RunResultsProps) {
  const [zipping, setZipping] = useState(false);
  const { files, skipped, mode } = run;
  const names = outputFileNames(files, mode, baseName, pageCount);
  const busy = run.kind === "running";
  const noun = mode === "pages" ? "page" : "image";
  const reduced = files.filter((f) => f.reduced);

  const downloadZip = async () => {
    setZipping(true);
    try {
      const zip = await createStoredZip(
        files.map((file, i) => ({ name: names[i], data: file.blob })),
      );
      downloadBlob(zip, archiveName(baseName, mode));
    } catch (err) {
      onError(`Could not create the ZIP: ${errorMessage(err)}`);
    } finally {
      setZipping(false);
    }
  };

  return (
    <section aria-label="Results" className="space-y-4">
      {busy && (
        <div className="space-y-2">
          <p role="status" aria-live="polite" className="text-sm font-medium">
            {run.stopping
              ? "Stopping after this page…"
              : `Page ${Math.min(run.done + 1, run.total)} of ${run.total}…`}
          </p>
          <Progress
            value={Math.round((run.done / Math.max(1, run.total)) * 100)}
            aria-label="Conversion progress"
          />
        </div>
      )}

      {run.kind === "failed" && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>The conversion stopped</AlertTitle>
          <AlertDescription>{run.message}</AlertDescription>
        </Alert>
      )}

      {run.kind === "finished" && run.stopped && (
        <p role="status" className="text-muted-foreground text-sm">
          Stopped. The {noun}s converted so far are below.
        </p>
      )}

      {run.kind === "finished" && files.length === 0 && mode === "images" && (
        <p role="status" className="text-muted-foreground">
          No images were found on the selected pages.
        </p>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {files.length} {noun}
            {files.length === 1 ? "" : "s"}
          </h2>
          {!busy && files.length > 1 && (
            <Button
              className="min-h-11 px-4"
              disabled={zipping}
              onClick={() => void downloadZip()}
            >
              <FileArchive aria-hidden="true" />
              {zipping ? "Preparing ZIP…" : "Download all (ZIP)"}
            </Button>
          )}
        </div>
      )}

      {reduced.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {pagesLabel(reduced.flatMap((f) => f.pages))}{" "}
          {reduced.length === 1 ? "was" : "were"} rendered at a lower resolution
          to stay within the browser&apos;s image size limit.
        </p>
      )}

      {skipped.length > 0 && (
        <Alert>
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>
            {skipped.length} {skipped.length === 1 ? "image" : "images"} could
            not be extracted
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5">
              {skipped.map((s) => (
                <li key={s.key}>
                  Page {s.page}: {s.reason}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {files.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((file, i) => (
            <li
              key={file.id}
              className="bg-card text-card-foreground flex min-w-0 flex-col overflow-hidden rounded-xl border"
            >
              <div className="flex h-48 items-center justify-center bg-[repeating-conic-gradient(var(--color-muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-2">
                <BlobImage
                  blob={file.blob}
                  alt={`${pagesLabel(file.pages)}, ${noun} ${i + 1}`}
                  className={previewClass(file)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium" title={names[i]}>
                    {names[i]}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {pagesLabel(file.pages)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {fileDetails(file)}
                  </p>
                </div>
                {!busy && (
                  <Button
                    variant="outline"
                    className="mt-auto min-h-11"
                    aria-label={`Download ${names[i]}`}
                    onClick={() => downloadBlob(file.blob, names[i])}
                  >
                    <Download aria-hidden="true" /> Download
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
