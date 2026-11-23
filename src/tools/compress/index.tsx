"use client";

/**
 * Main user interface for the Compress PDF tool (`/tools/compress/`).
 *
 * Follows SOLID Principles:
 * - Single Responsibility: Coordinates UI layout, file drops, batch downloads (single & ZIP),
 *   and accessibility announcements while delegating worker orchestration to `useCompressPdf`.
 * - Dependency Inversion: Delegates compression to the `useCompressPdf` hook abstraction.
 */

import {
  Archive,
  CheckCircle2,
  Download,
  Eye,
  FileDown,
  KeyRound,
  Plus,
  TriangleAlert,
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
import { formatBytes, isPdfFile, suffixedPdfName } from "@/lib/format";
import { blobZipEntry, createZip } from "@/lib/zip/zip";
import { CompressSettingsForm } from "./compress-settings";
import type { CompressFileItem } from "./compress-state";
import { validateCompressOptions } from "./core/options";
import { formatReductionPercent, formatSavingsSummary } from "./core/report";
import { SideBySidePreview } from "./side-by-side-preview";
import { useCompressPdf } from "./use-compress-pdf";

/** Status badge rendered per queued PDF row. */
function StatusFor({ item }: { item: CompressFileItem }) {
  switch (item.status.kind) {
    case "ready":
      return <StatusBadge tone="neutral">Ready</StatusBadge>;
    case "compressing":
      return <StatusBadge tone="busy">Compressing…</StatusBadge>;
    case "compressed":
      return <StatusBadge tone="success">Compressed</StatusBadge>;
    case "password-required":
      return <StatusBadge tone="warning">Password needed</StatusBadge>;
    case "error":
      return <StatusBadge tone="error">Failed</StatusBadge>;
  }
}

/**
 * Compress PDF tool page component: supports single and batch PDF compression,
 * Lossless / Balanced / Small / Custom / Target-size ("make it under X MB") modes,
 * before/after size reporting, and side-by-side page comparison before download.
 */
export default function CompressTool() {
  const {
    state,
    addFiles,
    removeFile,
    setOptions,
    compressAll,
    submitPassword,
    dismissPassword,
    reopenPassword,
    openPreview,
    closePreview,
    cancel,
    clear,
  } = useCompressPdf();

  const [zipping, setZipping] = useState(false);
  const addMoreInputRef = useRef<HTMLInputElement>(null);
  const validationError = validateCompressOptions(state.options);

  const handleFiles = (files: File[]) => {
    const pdfs = files.filter(isPdfFile);
    const rejected = files.filter((f) => !isPdfFile(f));
    if (rejected.length > 0) {
      toast.error(
        `Only PDF files are supported. Skipped: ${rejected.map((f) => f.name).join(", ")}`,
      );
    }
    if (pdfs.length > 0) {
      addFiles(pdfs);
    }
  };

  const compressedItems = state.items.filter(
    (
      i,
    ): i is CompressFileItem & {
      status: Extract<CompressFileItem["status"], { kind: "compressed" }>;
    } => i.status.kind === "compressed",
  );

  const hasReadyOrError = state.items.some(
    (i) => i.status.kind === "ready" || i.status.kind === "error",
  );

  const promptItem = state.items.find(
    (i) => i.status.kind === "password-required" && !i.status.dismissed,
  );

  const previewItem = state.preview
    ? state.items.find((i) => i.id === state.preview?.itemId)
    : undefined;

  const handleDownloadAllZip = async () => {
    if (compressedItems.length < 2 || zipping) return;
    setZipping(true);
    try {
      const usedNames = new Set<string>();
      const entries = await Promise.all(
        compressedItems.map(async (item) => {
          let name = suffixedPdfName(item.file.name, "-compressed");
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
      downloadBlob(zipBlob, "compressed-pdfs.zip");
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
          accept=".pdf,application/pdf"
          isAccepted={isPdfFile}
          onFiles={handleFiles}
          onRejected={(rejected) =>
            toast.error(
              `Only PDF files are supported. Skipped: ${rejected.map((f) => f.name).join(", ")}`,
            )
          }
          title="Drop PDF files here"
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
                accept=".pdf,application/pdf"
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
                disabled={state.isCompressing}
                onClick={() => addMoreInputRef.current?.click()}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add more PDFs
              </Button>
              <StartOverButton disabled={state.isCompressing} onClick={clear} />
            </div>
          </div>

          <CompressSettingsForm
            options={state.options}
            onChange={setOptions}
            validationError={validationError}
            disabled={state.isCompressing}
          />

          <ul className="space-y-3">
            {state.items.map((item) => {
              const s = item.status;
              const origLabel = formatBytes(item.file.size);
              const sizeLabel =
                s.kind === "compressed"
                  ? `${origLabel} → ${formatBytes(s.compressedBytes)} (-${formatReductionPercent(s.originalBytes, s.compressedBytes)}%)`
                  : origLabel;

              return (
                <FileRow
                  key={item.id}
                  name={item.file.name}
                  sizeLabel={sizeLabel}
                  status={<StatusFor item={item} />}
                  progress={
                    s.kind === "compressing"
                      ? Math.round(s.progress * 100)
                      : undefined
                  }
                  actions={
                    <>
                      {s.kind === "compressed" && (
                        <>
                          <Button
                            variant="outline"
                            className="min-h-10"
                            onClick={() => void openPreview(item.id, 0)}
                          >
                            <Eye className="size-4" aria-hidden="true" />
                            Preview
                          </Button>
                          <Button
                            className="min-h-10"
                            onClick={() =>
                              downloadBlob(
                                s.pdf,
                                suffixedPdfName(item.file.name, "-compressed"),
                              )
                            }
                          >
                            <Download className="size-4" aria-hidden="true" />
                            Download
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
                        disabled={s.kind === "compressing"}
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() => removeFile(item.id)}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </>
                  }
                  detail={
                    <>
                      {s.kind === "compressing" && s.stage && (
                        <p className="text-muted-foreground text-xs">
                          {s.stage}
                        </p>
                      )}
                      {s.kind === "compressed" && (
                        <div className="space-y-2">
                          <p className="text-muted-foreground text-xs">
                            {formatSavingsSummary(s.report)}
                          </p>
                          {s.targetEvaluation && (
                            <Alert
                              variant="default"
                              className={
                                s.targetEvaluation.targetMet
                                  ? "border-emerald-500/30 bg-emerald-500/10"
                                  : "border-amber-500/40 bg-amber-500/10"
                              }
                            >
                              {s.targetEvaluation.targetMet ? (
                                <CheckCircle2
                                  className="size-4 text-emerald-600 dark:text-emerald-400"
                                  aria-hidden="true"
                                />
                              ) : (
                                <TriangleAlert
                                  className="size-4 text-amber-600 dark:text-amber-400"
                                  aria-hidden="true"
                                />
                              )}
                              <AlertTitle>
                                {s.targetEvaluation.targetMet
                                  ? `Target size met (under ${formatBytes(s.targetEvaluation.targetBytes)})`
                                  : "Target size could not be reached safely"}
                              </AlertTitle>
                              {s.targetEvaluation.explanation && (
                                <AlertDescription className="text-xs">
                                  {s.targetEvaluation.explanation}
                                </AlertDescription>
                              )}
                            </Alert>
                          )}
                        </div>
                      )}
                      {s.kind === "error" && (
                        <Alert variant="destructive">
                          <AlertTitle>Could not compress this file</AlertTitle>
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

          {state.preview &&
            previewItem &&
            previewItem.status.kind === "compressed" && (
              <SideBySidePreview
                fileName={previewItem.file.name}
                originalBytes={previewItem.status.originalBytes}
                compressedBytes={previewItem.status.compressedBytes}
                preview={state.preview}
                onPageChange={(nextPage) =>
                  void openPreview(previewItem.id, nextPage)
                }
                onClose={closePreview}
              />
            )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {state.isCompressing ? (
              <Button variant="outline" onClick={cancel}>
                <X className="size-4" aria-hidden="true" />
                Cancel
              </Button>
            ) : (
              <>
                {compressedItems.length >= 2 && (
                  <Button
                    variant="outline"
                    disabled={zipping}
                    onClick={() => void handleDownloadAllZip()}
                  >
                    <Archive className="size-4" aria-hidden="true" />
                    {zipping ? "Building ZIP…" : "Download all (ZIP)"}
                  </Button>
                )}
                {hasReadyOrError && (
                  <Button
                    size="lg"
                    disabled={validationError !== null}
                    onClick={() => void compressAll()}
                  >
                    <FileDown className="size-4" aria-hidden="true" />
                    {state.items.length === 1
                      ? "Compress PDF"
                      : `Compress ${state.items.filter((i) => i.status.kind === "ready" || i.status.kind === "error").length} PDFs`}
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
          note="The compressed file is saved without a password."
          onSubmit={(pw) => void submitPassword(promptItem.id, pw)}
          onCancel={() => dismissPassword(promptItem.id)}
          cancelLabel="Skip this file"
        />
      )}
    </div>
  );
}
