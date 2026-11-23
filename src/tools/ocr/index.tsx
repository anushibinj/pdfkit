"use client";

/**
 * Main user interface for the OCR PDF tool (`/tools/ocr/`).
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Coordinates file drops (scanned PDFs and PNG/JPEG images),
 *   batch controls, ZIP downloads, and accessibility announcements while delegating
 *   OCR execution to `useOcrPdf`.
 * - Dependency Inversion: Delegates processing to the `useOcrPdf` hook abstraction.
 */

import {
  Archive,
  Download,
  FileText,
  KeyRound,
  Plus,
  ScanText,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { FileRow } from "@/components/file-row";
import { PasswordPrompt } from "@/components/password-prompt";
import { StartOverButton } from "@/components/start-over-button";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import { formatBytes } from "@/lib/format";
import { blobZipEntry, createZip } from "@/lib/zip/zip";
import {
  isSupportedOcrFile,
  ocrPdfFileName,
  validateOcrOptions,
} from "./core/options";
import { formatOcrSummary } from "./core/report";
import { OcrSettingsForm } from "./ocr-settings";
import type { OcrFileItem } from "./ocr-state";
import { TextResultPanel } from "./text-result-panel";
import { useOcrPdf } from "./use-ocr-pdf";

const OCR_ACCEPT = ".pdf,application/pdf,.png,image/png,.jpg,.jpeg,image/jpeg";

/** Status badge rendered per queued OCR file row. */
function StatusFor({ item }: { item: OcrFileItem }) {
  switch (item.status.kind) {
    case "ready":
      return <StatusBadge tone="neutral">Ready</StatusBadge>;
    case "processing":
      return <StatusBadge tone="busy">Recognizing…</StatusBadge>;
    case "completed":
      return <StatusBadge tone="success">Searchable</StatusBadge>;
    case "password-required":
      return <StatusBadge tone="warning">Password needed</StatusBadge>;
    case "error":
      return <StatusBadge tone="error">Failed</StatusBadge>;
  }
}

/**
 * OCR PDF tool component: converts scanned PDFs or PNG/JPEG images into
 * pixel-identical searchable PDFs with an invisible Unicode text layer
 * (supporting English + 10 Indian languages), plus Copy text and `.txt` export.
 */
export default function OcrTool() {
  const {
    state,
    addFiles,
    removeFile,
    setOptions,
    runAll,
    submitPassword,
    dismissPassword,
    reopenPassword,
    inspectText,
    cancel,
    clear,
  } = useOcrPdf();

  const [zipping, setZipping] = useState(false);
  const addMoreInputRef = useRef<HTMLInputElement>(null);
  const validationError = validateOcrOptions(state.options);

  const handleFiles = (files: File[]) => {
    const accepted = files.filter(isSupportedOcrFile);
    const rejected = files.filter((f) => !isSupportedOcrFile(f));
    if (rejected.length > 0) {
      toast.error(
        `Only PDF, PNG, and JPEG files are supported. Skipped: ${rejected.map((f) => f.name).join(", ")}`,
      );
    }
    if (accepted.length > 0) {
      addFiles(accepted);
    }
  };

  const completedItems = state.items.filter(
    (
      i,
    ): i is OcrFileItem & {
      status: Extract<OcrFileItem["status"], { kind: "completed" }>;
    } => i.status.kind === "completed",
  );

  const pendingItems = state.items.filter(
    (i) => i.status.kind === "ready" || i.status.kind === "error",
  );

  const promptItem = state.items.find(
    (i) => i.status.kind === "password-required" && !i.status.dismissed,
  );

  const inspectedItem = state.inspectedTextItemId
    ? state.items.find((i) => i.id === state.inspectedTextItemId)
    : undefined;

  const handleDownloadAllZip = async () => {
    if (completedItems.length < 2 || zipping) return;
    setZipping(true);
    try {
      const usedNames = new Set<string>();
      const entries = await Promise.all(
        completedItems.map(async (item) => {
          let name = ocrPdfFileName(item.file.name);
          if (usedNames.has(name)) {
            const stem = name.replace(/\.pdf$/i, "");
            let n = 2;
            while (usedNames.has(`${stem}-${n}.pdf`)) n++;
            name = `${stem}-${n}.pdf`;
          }
          usedNames.add(name);
          return blobZipEntry(name, item.status.pdf);
        }),
      );
      const zipBlob = createZip(entries, new Date());
      downloadBlob(zipBlob, "searchable-ocr-pdfs.zip");
    } catch {
      toast.error("Could not create the ZIP archive.");
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="space-y-6">
      {state.items.length === 0 && (
        <Dropzone
          accept={OCR_ACCEPT}
          isAccepted={isSupportedOcrFile}
          onFiles={handleFiles}
          onRejected={(rejected) =>
            toast.error(
              `Only PDF, PNG, and JPEG files are supported. Skipped: ${rejected.map((f) => f.name).join(", ")}`,
            )
          }
          title="Drop scanned PDFs or images here"
          buttonLabel="Choose PDFs or images"
        />
      )}

      {state.items.length > 0 && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              Files ({state.items.length})
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={addMoreInputRef}
                type="file"
                accept={OCR_ACCEPT}
                multiple
                className="sr-only"
                onChange={(e) => {
                  const chosen = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  handleFiles(chosen);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={state.isProcessing}
                onClick={() => addMoreInputRef.current?.click()}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add more files
              </Button>
              <StartOverButton disabled={state.isProcessing} onClick={clear} />
            </div>
          </div>

          <OcrSettingsForm
            options={state.options}
            onChange={setOptions}
            validationError={validationError}
            disabled={state.isProcessing}
          />

          <ul className="space-y-3">
            {state.items.map((item) => {
              const s = item.status;
              const sizeLabel =
                s.kind === "completed"
                  ? `${formatBytes(item.file.size)} → ${formatBytes(s.pdf.size)} · ${s.report.totalPages} ${s.report.totalPages === 1 ? "page" : "pages"}`
                  : formatBytes(item.file.size);

              return (
                <FileRow
                  key={item.id}
                  name={item.file.name}
                  sizeLabel={sizeLabel}
                  status={<StatusFor item={item} />}
                  progress={
                    s.kind === "processing"
                      ? Math.round(s.progress * 100)
                      : undefined
                  }
                  actions={
                    <>
                      {s.kind === "completed" && (
                        <>
                          <Button
                            variant="outline"
                            className="min-h-10"
                            onClick={() =>
                              inspectText(
                                state.inspectedTextItemId === item.id
                                  ? null
                                  : item.id,
                              )
                            }
                          >
                            <FileText className="size-4" aria-hidden="true" />
                            {state.inspectedTextItemId === item.id
                              ? "Hide text"
                              : "View text"}
                          </Button>
                          <Button
                            className="min-h-10"
                            onClick={() =>
                              downloadBlob(
                                s.pdf,
                                ocrPdfFileName(item.file.name),
                              )
                            }
                          >
                            <Download className="size-4" aria-hidden="true" />
                            Download PDF
                          </Button>
                        </>
                      )}
                      {s.kind === "password-required" && s.dismissed && (
                        <Button
                          variant="outline"
                          className="min-h-10"
                          onClick={() => reopenPassword(item.id)}
                        >
                          <KeyRound className="size-4" aria-hidden="true" />
                          Enter password
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        disabled={s.kind === "processing"}
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() => removeFile(item.id)}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </>
                  }
                  detail={
                    <>
                      {s.kind === "processing" && s.stage && (
                        <p className="text-muted-foreground text-xs">
                          {s.stage}
                        </p>
                      )}
                      {s.kind === "completed" && (
                        <p className="text-muted-foreground text-xs">
                          {formatOcrSummary(s.report)}
                        </p>
                      )}
                      {s.kind === "error" && (
                        <Alert variant="destructive">
                          <AlertTitle>Could not run OCR on this file</AlertTitle>
                          <AlertDescription className="text-xs">
                            {s.message}
                          </AlertDescription>
                        </Alert>
                      )}
                    </>
                  }
                />
              );
            })}
          </ul>

          {inspectedItem && inspectedItem.status.kind === "completed" && (
            <TextResultPanel
              fileName={inspectedItem.file.name}
              report={inspectedItem.status.report}
              onClose={() => inspectText(null)}
            />
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {state.isProcessing ? (
              <Button variant="outline" onClick={cancel}>
                <X className="size-4" aria-hidden="true" />
                Cancel
              </Button>
            ) : (
              <>
                {completedItems.length >= 2 && (
                  <Button
                    variant="outline"
                    disabled={zipping}
                    onClick={() => void handleDownloadAllZip()}
                  >
                    <Archive className="size-4" aria-hidden="true" />
                    {zipping ? "Building ZIP…" : "Download all (ZIP)"}
                  </Button>
                )}
                {pendingItems.length > 0 && (
                  <Button
                    size="lg"
                    disabled={validationError !== null}
                    onClick={() => void runAll()}
                  >
                    <ScanText className="size-4" aria-hidden="true" />
                    {state.items.length === 1
                      ? "Make searchable"
                      : `Make ${pendingItems.length} ${pendingItems.length === 1 ? "file" : "files"} searchable`}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {promptItem && promptItem.status.kind === "password-required" && (
        <PasswordPrompt
          key={promptItem.id}
          fileName={promptItem.file.name}
          wrong={Boolean(promptItem.status.wrongPassword)}
          note="Your password is kept locally and preserved in the searchable PDF."
          onSubmit={(pw) => void submitPassword(promptItem.id, pw)}
          onCancel={() => dismissPassword(promptItem.id)}
          cancelLabel="Skip this file"
        />
      )}
    </div>
  );
}
