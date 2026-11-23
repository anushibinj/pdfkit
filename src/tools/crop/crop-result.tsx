"use client";

import { CircleCheck, Download, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ReportSummary } from "./core/report";

interface CropResultProps {
  summary: ReportSummary;
  /** The name the download will have. */
  fileName: string;
  onDownload(): void;
  /** Go back to the settings to crop differently. */
  onBack(): void;
}

/**
 * The outcome of a crop: what was done, anything that could not be removed
 * and so stays in the file (listed so nobody assumes it is gone), notes,
 * and the download.
 *
 * @param props The summary and the actions.
 * @returns The result panel.
 */
export function CropResult({
  summary,
  fileName,
  onDownload,
  onBack,
}: CropResultProps) {
  return (
    <section aria-label="Result" className="space-y-4">
      <Alert>
        <CircleCheck aria-hidden="true" />
        <AlertTitle>Your PDF is cropped</AlertTitle>
        <AlertDescription>{summary.summary}</AlertDescription>
      </Alert>
      {summary.kept.length > 0 && (
        <Alert
          role="note"
          className="border-yellow-300 bg-yellow-50 text-yellow-950 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-100"
        >
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Still in the file</AlertTitle>
          <AlertDescription className="text-yellow-900 dark:text-yellow-200">
            <ul className="list-disc space-y-1 pl-4">
              {summary.kept.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {summary.notes.map((note) => (
        <p key={note} className="text-muted-foreground text-sm">
          {note}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="lg" className="min-h-11 px-4" onClick={onDownload}>
          <Download aria-hidden="true" />
          Download {fileName}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="min-h-11 px-4"
          onClick={onBack}
        >
          Change the crop
        </Button>
      </div>
    </section>
  );
}
