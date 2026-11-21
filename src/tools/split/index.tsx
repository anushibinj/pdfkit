"use client";

import { LockKeyhole, X } from "lucide-react";
import { useMemo, useReducer, useState } from "react";
import { toast } from "sonner";
import { BetaNotice } from "@/components/beta-notice";
import { Dropzone } from "@/components/dropzone";
import { PasswordPrompt } from "@/components/password-prompt";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { downloadBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { formatBytes, isPdfFile } from "@/lib/format";
import { outputFileNames, zipFileName } from "./core/file-names";
import { planOutputs } from "./core/output-plan";
import type { SelectionAction } from "./core/page-selection";
import { actionLabel, filesLabel, filesPerPage, planKey } from "./core/plan-view";
import {
  INITIAL_SETTINGS,
  settingsReducer,
  toPlanSettings,
} from "./core/split-settings";
import { createZip } from "./core/zip";
import { ModePicker } from "./mode-picker";
import { PageField } from "./page-field";
import { PageGrid } from "./page-grid";
import { ResultsList } from "./results-list";
import { SplitOptions } from "./split-options";
import { useSplitDocument } from "./use-split-document";
import { useSplitOutputs, type OutputFile } from "./use-split-outputs";

/**
 * Larger PDFs are refused: the file is held in memory several times (this
 * tab, the preview engine, and qpdf while files are made).
 */
export const MAX_PDF_BYTES = 200 * 1024 * 1024;

/**
 * Split PDF: open a PDF, then split it into several files, extract the
 * pages you pick into a new file, or remove the pages you pick. Thumbnails
 * are drawn by PDFium and the files are made by qpdf, both in Web Workers
 * in this tab; nothing is uploaded.
 */
export default function SplitTool() {
  const doc = useSplitDocument();
  const outputs = useSplitOutputs();
  const [settings, dispatchSettings] = useReducer(settingsReducer, INITIAL_SETTINGS);
  const { mode, splitMethod, everyN, rangesText, selection } = settings;
  const select = (action: SelectionAction) =>
    dispatchSettings({ type: "selection", action });
  const [announcement, setAnnouncement] = useState("");

  const ready = doc.status.kind === "ready" ? doc.status : null;
  const pageCount = ready?.pages.length ?? 0;
  const plan = useMemo(
    () => (ready ? planOutputs(toPlanSettings(settings, pageCount)) : null),
    [ready, settings, pageCount],
  );
  const key = plan?.ok ? planKey(mode, plan.outputs) : null;
  const pageFiles = useMemo(
    () => (mode === "split" && plan?.ok ? filesPerPage(plan.outputs, pageCount) : null),
    [mode, plan, pageCount],
  );
  const { state } = outputs;
  const working = state.kind === "working";
  // Results are shown only while they match the current settings.
  const result = state.kind !== "idle" && state.key === key ? state : null;

  const resetSettings = () => dispatchSettings({ type: "reset" });

  const openFiles = async (files: File[]) => {
    const [file] = files;
    if (files.length > 1) toast.info(`Opened ${file.name}. One file at a time.`);
    if (file.size > MAX_PDF_BYTES) {
      toast.error(
        `${file.name} is over ${formatBytes(MAX_PDF_BYTES)}, too large to split in the browser.`,
      );
      return;
    }
    outputs.reset();
    resetSettings();
    await doc.openFile(file);
  };

  const closeFile = () => {
    outputs.reset();
    resetSettings();
    doc.close();
  };

  const build = async () => {
    const source = doc.getSource();
    if (!ready || !plan?.ok || !key || !source) return;
    const names = outputFileNames(ready.fileName, mode, plan.outputs);
    setAnnouncement("Making the files…");
    const end = await outputs.build({
      key,
      source,
      pageCount,
      outputs: plan.outputs.map((o, i) => ({ name: names[i], pages: o.pages })),
    });
    if (end?.kind === "done") {
      setAnnouncement(
        end.files.length === 1
          ? `${end.files[0].name} is ready to download.`
          : `${end.files.length} files are ready to download.`,
      );
    } else if (end?.kind === "failed") {
      setAnnouncement(`Could not make the files. ${end.message}`);
    } else if (end) {
      setAnnouncement("Cancelled.");
    }
  };

  const download = (file: OutputFile) =>
    downloadBlob(new Blob([file.data], { type: "application/pdf" }), file.name);

  const downloadAll = (files: readonly OutputFile[]) => {
    if (!ready) return;
    try {
      const zip = createZip(
        files.map((f) => ({ name: f.name, data: f.data, crc32: f.crc32 })),
        new Date(),
      );
      downloadBlob(zip, zipFileName(ready.fileName));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const picking = mode === "extract" || mode === "remove";
  // A typing mistake is shown on the page field; other reasons next to the
  // button (e.g. "Pick at least one page to extract.").
  const buttonHint =
    plan && !plan.ok && !(picking && selection.error) && mode !== "split"
      ? plan.error
      : null;

  return (
    <div className="space-y-6">
      <BetaNotice title="Beta: what is and is not kept">
        <li>
          Pages are copied as they are: text, images, comments, form fields and
          links between kept pages stay, and nothing is re-compressed.
        </li>
        <li>
          The new files keep the original&apos;s password and document
          properties such as the title.
        </li>
        <li>
          Bookmarks and links that pointed to a page left out no longer go
          anywhere, and digital signatures are no longer valid in the new files.
        </li>
      </BetaNotice>

      {doc.status.kind === "failed" && (
        <Alert variant="destructive">
          <AlertTitle>Could not open {doc.status.fileName}</AlertTitle>
          <AlertDescription>{doc.status.message}</AlertDescription>
        </Alert>
      )}

      {(doc.status.kind === "empty" || doc.status.kind === "failed") && (
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

      {(doc.status.kind === "opening" || doc.status.kind === "needs-password") && (
        <p
          role="status"
          className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm"
        >
          {doc.status.kind === "opening"
            ? `Opening ${doc.status.fileName}… The first time, the PDF engine (about 5 MB) is downloaded, so it takes a little longer.`
            : `${doc.status.fileName} is protected with a password.`}
        </p>
      )}

      {doc.status.kind === "needs-password" && (
        <PasswordPrompt
          key={doc.status.fileName}
          fileName={doc.status.fileName}
          wrong={doc.status.wrong}
          note="The new files keep the same password."
          onSubmit={(password) => void doc.submitPassword(password)}
          onCancel={closeFile}
        />
      )}

      {ready && plan && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3">
            <div className="min-w-0 flex-1 basis-48">
              <p className="truncate font-medium" title={ready.fileName}>
                {ready.fileName}
              </p>
              <p className="text-muted-foreground text-sm">
                {pageCount === 1 ? "1 page" : `${pageCount} pages`} ·{" "}
                {formatBytes(ready.fileSize)}
              </p>
            </div>
            {ready.withPassword && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <LockKeyhole className="size-4" aria-hidden="true" />
                The new files keep the same password.
              </p>
            )}
            <Button
              variant="outline"
              className="min-h-11"
              disabled={working}
              onClick={closeFile}
            >
              <X aria-hidden="true" /> Open another PDF
            </Button>
          </div>

          <ModePicker
            mode={mode}
            onChange={(next) => dispatchSettings({ type: "set-mode", mode: next })}
            disabled={working}
          />

          {mode === "split" ? (
            <SplitOptions
              method={splitMethod}
              onMethodChange={(method) =>
                dispatchSettings({ type: "set-split-method", method })
              }
              everyN={everyN}
              onEveryNChange={(value) => dispatchSettings({ type: "set-every", value })}
              ranges={rangesText}
              onRangesChange={(value) => dispatchSettings({ type: "set-ranges", value })}
              error={plan.ok ? null : plan.error}
              disabled={working}
            />
          ) : (
            <PageField
              label={mode === "extract" ? "Pages to extract" : "Pages to remove"}
              value={selection.text}
              onChange={(text) => select({ type: "type", text, pageCount })}
              onClear={() => select({ type: "clear" })}
              error={selection.error}
              disabled={working}
            />
          )}

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="min-h-11 px-5 text-base"
                disabled={!plan.ok || working}
                onClick={() => void build()}
              >
                {actionLabel(mode, plan, pageCount)}
              </Button>
              {working && (
                <Button variant="outline" className="min-h-11" onClick={outputs.cancel}>
                  Cancel
                </Button>
              )}
              {buttonHint && <p className="text-muted-foreground text-sm">{buttonHint}</p>}
            </div>
            {state.kind === "working" && (
              <Progress
                value={Math.round(state.progress * 100)}
                aria-label="Making the files"
              />
            )}
          </div>

          {result?.kind === "failed" && (
            <Alert variant="destructive">
              <AlertTitle>Could not make the files</AlertTitle>
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          )}
          {result?.kind === "done" && (
            <ResultsList
              files={result.files}
              warnings={result.warnings}
              onDownload={download}
              onDownloadAll={() => downloadAll(result.files)}
            />
          )}

          <PageGrid
            pages={ready.pages}
            renderPage={doc.renderPage}
            label={
              mode === "extract"
                ? "Pick pages to extract"
                : mode === "remove"
                  ? "Pick pages to remove"
                  : "Pages"
            }
            markOf={(i) =>
              !picking || !selection.pages.has(i)
                ? "none"
                : mode === "remove"
                  ? "removed"
                  : "picked"
            }
            captionOf={pageFiles ? (i) => filesLabel(pageFiles[i]) : undefined}
            onToggle={
              picking
                ? (index, extend) => select({ type: "toggle", index, extend })
                : undefined
            }
            disabled={working}
          />
        </>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
