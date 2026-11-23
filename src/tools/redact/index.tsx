"use client";

import { ShieldAlert } from "lucide-react";
import { useCallback, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { PasswordPrompt } from "@/components/password-prompt";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { downloadBlob } from "@/lib/download";
import { formatBytes, isPdfFile, suffixedPdfName } from "@/lib/format";
import type { PageBox } from "@/lib/pdfium/page-box";
import {
  DEFAULT_CLEANUP_OPTIONS,
  DEFAULT_MARK_STYLE,
  type CleanupOptions,
  type RedactionMark,
  type RedactionMarkStyle,
} from "./core/model";
import { jobProgress, marksReducer } from "./document-state";
import type { SearchQuery } from "./messages";
import { PagePreview } from "./page-preview";
import { RedactResult } from "./redact-result";
import { RedactSettings } from "./redact-settings";
import { ReviewList } from "./review-list";
import { SearchPanel } from "./search-panel";
import { usePdfRedact } from "./use-pdf-redact";

/** Maximum file size accepted for client-side redaction (100 MB). */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/**
 * Redact PDF: draw redaction areas or search with plain text, regex, and
 * sensitive-data presets, review every mark to untick false positives,
 * permanently remove text/images/paths/annotations and document metadata,
 * rewrite a single-revision PDF, and verify after saving that 0 terms remain.
 */
export default function RedactTool() {
  const redact = usePdfRedact();
  const { status, job } = redact;
  const [marks, dispatchMarks] = useReducer(marksReducer, []);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [style, setStyle] = useState<RedactionMarkStyle>(DEFAULT_MARK_STYLE);
  const [cleanup, setCleanup] = useState<CleanupOptions>(
    DEFAULT_CLEANUP_OPTIONS,
  );
  const [rasterizePages, setRasterizePages] = useState(false);
  const [searching, setSearching] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const markSeq = useRef(0);
  const docGenRef = useRef(0);

  const ready = status.kind === "ready" ? status : null;
  const working = job.kind === "working";
  const enabledMarks = marks.filter((m) => m.enabled);

  const nextMarkId = useCallback(() => `m${++markSeq.current}`, []);

  const resetUi = () => {
    docGenRef.current++;
    dispatchMarks({ type: "clear" });
    setPageIndex(0);
    setSelectedMarkId(null);
    setStyle(DEFAULT_MARK_STYLE);
    setCleanup(DEFAULT_CLEANUP_OPTIONS);
    setRasterizePages(false);
  };

  const openFiles = async (files: File[]) => {
    const [file] = files;
    if (files.length > 1) {
      toast.info(`Opened ${file.name}. One file at a time.`);
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error(
        `${file.name} is over ${formatBytes(MAX_PDF_BYTES)}, too large to redact in the browser.`,
      );
      return;
    }
    resetUi();
    await redact.openFile(file);
  };

  const handleAddBox = async (box: PageBox) => {
    const gen = docGenRef.current;
    const targetPage = pageIndex;
    const term = await redact.extractTextUnderBox(targetPage, box);
    if (gen !== docGenRef.current) return;
    const id = nextMarkId();
    const mark: RedactionMark = {
      id,
      pageIndex: targetPage,
      box,
      term,
      source: "manual",
      label: "Manual",
      enabled: true,
    };
    dispatchMarks({ type: "add", mark });
    setSelectedMarkId(id);
    setAnnouncement(
      term
        ? `Added redaction mark for "${term}" on page ${targetPage + 1}.`
        : `Added area redaction mark on page ${targetPage + 1}.`,
    );
  };

  const handleSearch = async (query: SearchQuery) => {
    const gen = docGenRef.current;
    setSearching(true);
    try {
      const candidates = await redact.search(query);
      if (gen !== docGenRef.current) return;
      if (!candidates || candidates.length === 0) {
        toast.info("No matches found in this PDF.");
        setAnnouncement("No matches found.");
        return;
      }
      const added: RedactionMark[] = candidates.map((c) => ({
        ...c,
        id: nextMarkId(),
      }));
      dispatchMarks({ type: "add-batch", marks: added });
      setPageIndex(added[0].pageIndex);
      setSelectedMarkId(added[0].id);
      const msg = `Found ${added.length} ${added.length === 1 ? "match" : "matches"} across the document.`;
      toast.success(msg);
      setAnnouncement(msg);
    } finally {
      if (gen === docGenRef.current) {
        setSearching(false);
      }
    }
  };

  const startRedact = async () => {
    if (!ready || enabledMarks.length === 0) return;
    setAnnouncement("Applying permanent redactions and verifying output…");
    await redact.applyRedactions({
      marks,
      style,
      cleanup,
      rasterizePages,
    });
  };

  const downloadName = ready
    ? suffixedPdfName(ready.fileName, "-redacted")
    : "";

  const download = () => {
    if (job.kind !== "done") return;
    downloadBlob(
      new Blob([job.data], { type: "application/pdf" }),
      downloadName,
    );
    setAnnouncement(`Saved ${downloadName}.`);
  };

  const progressLabel =
    job.kind === "working"
      ? job.stage === "cleaning"
        ? "Scrubbing metadata, scripts, and incremental history…"
        : job.stage === "verifying"
          ? "Reopening saved PDF to verify 0 redacted terms remain…"
          : "Removing redacted text, image pixels, and paths…"
      : "";

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

      {(status.kind === "opening" || status.kind === "needs-password") && (
        <p
          role="status"
          className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm"
        >
          {status.kind === "opening"
            ? `Opening ${status.fileName}… The first time, the PDF engine (about 5 MB) is downloaded, so it takes a little longer.`
            : `${status.fileName} is protected with a password.`}
        </p>
      )}

      {status.kind === "needs-password" && (
        <PasswordPrompt
          key={status.fileName}
          fileName={status.fileName}
          wrong={status.wrong}
          note="The redacted output will be saved as a fresh unencrypted single-revision PDF."
          onSubmit={(password) => void redact.submitPassword(password)}
          onCancel={() => {
            resetUi();
            redact.close();
          }}
        />
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
                resetUi();
                redact.close();
              }}
            >
              Open another PDF
            </Button>
          </div>

          <div className="grid gap-8 pb-12 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <PagePreview
              pageIndex={pageIndex}
              pageCount={ready.pages.length}
              info={ready.pages[pageIndex]}
              marks={marks}
              selectedMarkId={selectedMarkId}
              style={style}
              disabled={working || job.kind === "done"}
              renderPage={redact.renderPage}
              onPageChange={setPageIndex}
              onAddBox={(box) => void handleAddBox(box)}
              onSelectMark={setSelectedMarkId}
              onDeleteSelectedMark={() => {
                if (!selectedMarkId) return;
                dispatchMarks({ type: "remove", id: selectedMarkId });
                setSelectedMarkId(null);
              }}
            />

            <div className="space-y-4">
              {job.kind === "done" ? (
                <RedactResult
                  report={job.report}
                  fileName={downloadName}
                  onDownload={download}
                  onBack={redact.resetJob}
                />
              ) : (
                <>
                  <SearchPanel
                    disabled={working}
                    searching={searching}
                    onSearch={handleSearch}
                  />

                  <ReviewList
                    marks={marks}
                    selectedMarkId={selectedMarkId}
                    disabled={working}
                    onToggle={(id) => dispatchMarks({ type: "toggle", id })}
                    onSelect={(mark) => {
                      setPageIndex(mark.pageIndex);
                      setSelectedMarkId(mark.id);
                    }}
                    onRemove={(id) => {
                      dispatchMarks({ type: "remove", id });
                      if (selectedMarkId === id) setSelectedMarkId(null);
                    }}
                    onSetAll={(enabled) =>
                      dispatchMarks({ type: "set-all", enabled })
                    }
                    onClear={() => {
                      dispatchMarks({ type: "clear" });
                      setSelectedMarkId(null);
                    }}
                  />

                  <RedactSettings
                    style={style}
                    cleanup={cleanup}
                    rasterizePages={rasterizePages}
                    disabled={working}
                    onStyleChange={setStyle}
                    onCleanupChange={setCleanup}
                    onRasterizeChange={setRasterizePages}
                  />

                  {job.kind === "failed" && (
                    <Alert variant="destructive">
                      <ShieldAlert aria-hidden="true" />
                      <AlertTitle>Redaction did not complete</AlertTitle>
                      <AlertDescription>{job.message}</AlertDescription>
                    </Alert>
                  )}

                  {working && (
                    <Progress
                      value={Math.round(jobProgress(job) * 100)}
                      aria-label={progressLabel}
                    >
                      <span className="text-sm">{progressLabel}</span>
                    </Progress>
                  )}

                  <Button
                    size="lg"
                    className="min-h-11 w-full px-4"
                    disabled={working || enabledMarks.length === 0}
                    onClick={() => void startRedact()}
                  >
                    Apply {enabledMarks.length}{" "}
                    {enabledMarks.length === 1 ? "redaction" : "redactions"}{" "}
                    &amp; verify
                  </Button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {job.kind === "done"
          ? `Redacted and verified. ${job.report.verification.summary}.`
          : job.kind === "failed"
            ? `Redaction failed. ${job.message}`
            : announcement}
      </div>
    </div>
  );
}
