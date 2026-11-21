"use client";

import { Download, FileArchive, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { formatPageRuns, toPageRuns } from "./core/page-ranges";
import type { OutputFile } from "./use-split-outputs";

/** Rows shown before the list says "and N more". */
export const MAX_LISTED_FILES = 100;

interface ResultsListProps {
  files: readonly OutputFile[];
  /** qpdf's warnings, if any. */
  warnings?: string;
  onDownload(file: OutputFile): void;
  onDownloadAll(): void;
}

/**
 * Describe a file's pages for its row: "Page 4" or "Pages 1-3, 5".
 *
 * @param pages Source page indices.
 * @returns The description.
 */
export function describeFilePages(pages: readonly number[]): string {
  return `${pages.length === 1 ? "Page" : "Pages"} ${formatPageRuns(toPageRuns(pages))}`;
}

/**
 * The built files, each with its own Download button, plus "Download all"
 * as one ZIP when there are several.
 *
 * A split into single pages can make hundreds of files; listing them all
 * would bury the page, so only the first {@link MAX_LISTED_FILES} get a
 * row, and the ZIP holds every file.
 *
 * @param props The files and the download handlers.
 * @returns The results section.
 */
export function ResultsList({ files, warnings, onDownload, onDownloadAll }: ResultsListProps) {
  const listed = files.slice(0, MAX_LISTED_FILES);
  const hidden = files.length - listed.length;
  return (
    <section aria-label="Your files" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {files.length === 1 ? "Your file is ready" : `${files.length} files are ready`}
        </h2>
        {files.length > 1 && (
          <Button className="min-h-11" onClick={onDownloadAll}>
            <FileArchive aria-hidden="true" /> Download all (.zip)
          </Button>
        )}
      </div>
      {warnings && (
        <p className="text-muted-foreground text-sm">
          qpdf repaired something while copying: {warnings}
        </p>
      )}
      <ul className="space-y-2">
        {listed.map((file) => (
          <li
            key={file.name}
            className="bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3"
          >
            <FileText className="text-muted-foreground size-6 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 basis-40">
              <p className="truncate font-medium" title={file.name}>
                {file.name}
              </p>
              <p className="text-muted-foreground text-sm">
                {describeFilePages(file.pages)} · {formatBytes(file.data.byteLength)}
              </p>
            </div>
            <Button
              variant={files.length === 1 ? "default" : "outline"}
              className="min-h-11"
              aria-label={`Download ${file.name}`}
              onClick={() => onDownload(file)}
            >
              <Download aria-hidden="true" /> Download
            </Button>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="text-muted-foreground text-sm">
          And {hidden} more {hidden === 1 ? "file" : "files"}, all included in the ZIP.
        </p>
      )}
    </section>
  );
}
