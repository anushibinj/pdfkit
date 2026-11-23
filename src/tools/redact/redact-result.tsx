"use client";

import { Download, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { RedactionReport } from "./core/model";

export interface RedactResultProps {
  report: RedactionReport;
  fileName: string;
  onDownload(): void;
  onBack(): void;
}

/**
 * Displays the post-save verification verdict (`"0 of N redacted terms remain"`),
 * surgical removal metrics, and the verified download button.
 *
 * @param props Redaction report, output filename, and action callbacks.
 * @returns Result summary panel.
 */
export function RedactResult({
  report,
  fileName,
  onDownload,
  onBack,
}: RedactResultProps) {
  const details: string[] = [
    `${report.marksApplied} ${report.marksApplied === 1 ? "mark" : "marks"} applied across ${report.pagesRedacted} ${report.pagesRedacted === 1 ? "page" : "pages"}`,
  ];
  if (report.textObjectsRemoved + report.textObjectsSplit > 0) {
    details.push(
      `${report.textObjectsRemoved} text objects removed, ${report.textObjectsSplit} split`,
    );
  }
  if (report.imagesModified > 0) {
    details.push(
      `${report.imagesModified} ${report.imagesModified === 1 ? "image" : "images"} pixel-blanked`,
    );
  }
  if (report.pathsRemoved > 0) {
    details.push(`${report.pathsRemoved} vector paths removed`);
  }
  if (report.annotationsRemoved > 0) {
    details.push(`${report.annotationsRemoved} annotations/links removed`);
  }
  if (report.sanitize.formValuesCleared > 0) {
    details.push(
      `${report.sanitize.formValuesCleared} ${report.sanitize.formValuesCleared === 1 ? "form value" : "form values"} cleared`,
    );
  }
  if (report.pagesRasterized > 0) {
    details.push(`${report.pagesRasterized} pages rasterised`);
  }
  if (
    report.sanitize.metadataEntriesRemoved +
      report.sanitize.xmpStreamsRemoved >
    0
  ) {
    details.push(
      `Metadata scrubbed (${report.sanitize.metadataEntriesRemoved} entries, ${report.sanitize.xmpStreamsRemoved} XMP streams)`,
    );
  }
  if (report.sanitize.attachmentsRemoved > 0) {
    details.push(
      `${report.sanitize.attachmentsRemoved} ${report.sanitize.attachmentsRemoved === 1 ? "attachment" : "attachments"} removed`,
    );
  }
  if (report.sanitize.javascriptActionsRemoved > 0) {
    details.push(
      `${report.sanitize.javascriptActionsRemoved} JavaScript ${report.sanitize.javascriptActionsRemoved === 1 ? "action" : "actions"} removed`,
    );
  }
  if (report.sanitize.hiddenLayersRemoved > 0) {
    details.push(
      `${report.sanitize.hiddenLayersRemoved} hidden ${report.sanitize.hiddenLayersRemoved === 1 ? "layer" : "layers"} stripped`,
    );
  }
  if (report.sanitize.bookmarksCleaned > 0) {
    details.push(`${report.sanitize.bookmarksCleaned} bookmark titles scrubbed`);
  }
  if (report.sanitize.objectsPruned > 0) {
    details.push(
      `${report.sanitize.objectsPruned} unreferenced objects pruned (single revision)`,
    );
  }

  return (
    <section aria-label="Redaction result" className="space-y-4">
      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>Verified after saving</AlertTitle>
        <AlertDescription className="font-medium">
          {report.verification.summary}
        </AlertDescription>
      </Alert>

      <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
        {details.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

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
          Back to review
        </Button>
      </div>
    </section>
  );
}
