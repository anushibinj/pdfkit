"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { downloadBlob } from "@/lib/download";
import { formatBytes, isPdfFile, suffixedPdfName } from "@/lib/format";
import { buildCropPlan } from "./core/crop-plan";
import { describeReport } from "./core/report";
import {
  DEFAULT_SETTINGS,
  hasMargins,
  selectedPages,
  type CropSettings,
} from "./core/settings";
import { CropResult } from "./crop-result";
import { CropSettingsForm } from "./crop-settings";
import { jobProgress } from "./document-state";
import { PagePreview } from "./page-preview";
import { usePdfCrop } from "./use-pdf-crop";

/**
 * Larger PDFs are refused: the file is held in memory several times (the
 * preview engine, the cropping engine, the result and its check).
 */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/**
 * Crop PDF: open a PDF, set the crop area by dragging it on a page or
 * typing margins, choose the pages, optionally remove what lies outside,
 * and download the result. Everything runs in this tab; the engines live
 * in a Web Worker.
 */
export default function CropTool() {
  const crop = usePdfCrop();
  const { status, job } = crop;
  const [settings, setSettings] = useState<CropSettings>(DEFAULT_SETTINGS);
  const [pageIndex, setPageIndex] = useState(0);
  const [planError, setPlanError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const ready = status.kind === "ready" ? status : null;
  const working = job.kind === "working";
  const selection = ready ? selectedPages(settings, ready.pages.length) : null;
  const rangeError =
    settings.pages === "range" && selection && !selection.ok
      ? selection.message
      : null;
  // Without margins and without removing, cropping would change nothing.
  const canCrop =
    !working && (hasMargins(settings.margins) || settings.removeOutside);

  const openFiles = async (files: File[]) => {
    const [file] = files;
    if (files.length > 1)
      toast.info(`Opened ${file.name}. One file at a time.`);
    if (file.size > MAX_PDF_BYTES) {
      toast.error(
        `${file.name} is over ${formatBytes(MAX_PDF_BYTES)}, too large to crop in the browser.`,
      );
      return;
    }
    setSettings(DEFAULT_SETTINGS);
    setPageIndex(0);
    setPlanError(null);
    await crop.openFile(file);
  };

  const startCrop = async () => {
    if (!ready || !selection) return;
    if (!selection.ok) {
      setPlanError(selection.message);
      return;
    }
    const built = buildCropPlan(
      ready.pages,
      selection.pages,
      settings.margins,
      settings.removeOutside,
    );
    if (!built.ok) {
      setPlanError(built.message);
      if (built.pageIndex >= 0) setPageIndex(built.pageIndex);
      return;
    }
    setPlanError(null);
    setAnnouncement("Cropping…");
    await crop.crop(built.plan);
  };

  const downloadName = ready ? suffixedPdfName(ready.fileName, "-cropped") : "";

  const download = () => {
    if (job.kind !== "done") return;
    downloadBlob(
      new Blob([job.data], { type: "application/pdf" }),
      downloadName,
    );
    setAnnouncement(`Saved ${downloadName}.`);
  };

  const progressLabel =
    job.kind === "working" && job.stage === "checking"
      ? "Checking every cropped page against the original…"
      : "Cropping…";

  return (
    <div className="space-y-6">
      {status.kind === "failed" && (
        <Alert variant="destructive">
          <AlertTitle>Could not open {status.fileName}</AlertTitle>
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      )}

      {(status.kind === "empty" || status.kind === "failed") && (
        <Dropzone
          accept=".pdf,application/pdf"
          isAccepted={isPdfFile}
          onFiles={(files) => void openFiles(files)}
          onRejected={(files) =>
            toast.error(
              `Only PDF files are supported. Skipped: ${files.map((f) => f.name).join(", ")}`,
            )
          }
          title="Drop a PDF here"
          buttonLabel="Choose a PDF"
        />
      )}

      {status.kind === "opening" && (
        <p
          role="status"
          className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm"
        >
          Opening {status.fileName}… The first time, the PDF engine (about 5 MB)
          is downloaded, so it takes a little longer.
        </p>
      )}

      {ready && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-medium">
              {ready.fileName}
            </p>
            <Button
              variant="outline"
              className="min-h-11 px-4"
              disabled={working}
              onClick={() => {
                setPlanError(null);
                crop.close();
              }}
            >
              Open another PDF
            </Button>
          </div>
          <div className="grid gap-8 pb-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <PagePreview
              pageIndex={pageIndex}
              pageCount={ready.pages.length}
              info={ready.pages[pageIndex]}
              renderPage={crop.renderPage}
              margins={settings.margins}
              onMarginsChange={(margins) =>
                setSettings((s) => ({ ...s, margins }))
              }
              onPageChange={setPageIndex}
              disabled={working || job.kind === "done"}
            />
            <div className="space-y-5">
              {job.kind === "done" ? (
                <CropResult
                  summary={describeReport(job.report, job.removeOutside)}
                  fileName={downloadName}
                  onDownload={download}
                  onBack={crop.resetJob}
                />
              ) : (
                <>
                  <CropSettingsForm
                    settings={settings}
                    onChange={setSettings}
                    rangeError={rangeError}
                    disabled={working}
                  />
                  {planError && (
                    <Alert variant="destructive">
                      <AlertDescription>{planError}</AlertDescription>
                    </Alert>
                  )}
                  {job.kind === "failed" && (
                    <Alert variant="destructive">
                      <AlertTitle>Could not crop the PDF</AlertTitle>
                      <AlertDescription>{job.message}</AlertDescription>
                    </Alert>
                  )}
                  {working && (
                    <Progress
                      value={Math.round(
                        jobProgress(job, settings.removeOutside) * 100,
                      )}
                      aria-label={progressLabel}
                    >
                      <span className="text-sm">{progressLabel}</span>
                    </Progress>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="lg"
                      className="min-h-11 px-4"
                      disabled={!canCrop}
                      onClick={() => void startCrop()}
                    >
                      Crop PDF
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      className="min-h-11 px-4"
                      disabled={working || !hasMargins(settings.margins)}
                      onClick={() =>
                        setSettings((s) => ({
                          ...s,
                          margins: DEFAULT_SETTINGS.margins,
                        }))
                      }
                    >
                      Reset margins
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {job.kind === "done"
          ? "Cropped. The PDF is ready to download."
          : job.kind === "failed"
            ? `Could not crop the PDF. ${job.message}`
            : announcement}
      </div>
    </div>
  );
}
