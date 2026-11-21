"use client";

import { Download, FilePlus2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { BetaNotice } from "@/components/beta-notice";
import { Dropzone } from "@/components/dropzone";
import { PasswordPrompt } from "@/components/password-prompt";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { canDecodeImage } from "@/lib/decode-image";
import { downloadBlob } from "@/lib/download";
import { formatBytes, isPdfFile, suffixedPdfName } from "@/lib/format";
import { MAX_IMAGE_BYTES, readImageInfo } from "@/lib/image-info";
import { readSingleFile } from "@/lib/read-single-file";
import {
  DEFAULT_FORM,
  checkForm,
  previewSettings,
  type WatermarkForm,
} from "./core/form";
import { PreviewPane } from "./preview-pane";
import { SettingsPanel } from "./settings-panel";
import { useWatermark } from "./use-watermark";

/** Larger PDFs are refused: the file is held in memory more than once. */
export const MAX_PDF_BYTES = 200 * 1024 * 1024;

/**
 * Add watermark: open a PDF, choose a text or picture watermark and where
 * it goes, check it in the live preview and download the result. All work
 * happens in a Web Worker on this device.
 */
export default function WatermarkTool() {
  const tool = useWatermark();
  const { status } = tool;
  const [form, setForm] = useState<WatermarkForm>(DEFAULT_FORM);
  const [pageIndex, setPageIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const problemId = useId();
  const ready = status.kind === "ready" ? status : null;
  const pageCount = ready?.pageCount ?? 1;

  // Memoised so the preview only re-renders when the settings really
  // change (a new object on every render would restart it each time).
  const check = useMemo(() => checkForm(form, pageCount), [form, pageCount]);
  const shownSettings = useMemo(
    () => previewSettings(check, pageIndex),
    [check, pageIndex],
  );

  const update = (patch: Partial<WatermarkForm>) =>
    setForm((current) => ({ ...current, ...patch }));

  const openFiles = async (files: File[]) => {
    const [file] = files;
    if (files.length > 1)
      toast.info(`Opened ${file.name}. One file at a time.`);
    if (file.size > MAX_PDF_BYTES) {
      toast.error(
        `${file.name} is over ${formatBytes(MAX_PDF_BYTES)}, too large to watermark in the browser.`,
      );
      return;
    }
    setPageIndex(0);
    await tool.openFile(file);
  };

  const pickImage = async (file: File) => {
    const opened = await readSingleFile(
      [file],
      MAX_IMAGE_BYTES,
      (f) => f.arrayBuffer(),
      toast,
    );
    if (!opened) return;
    const bytes = opened.content;
    const info = readImageInfo(new Uint8Array(bytes));
    if (!info) {
      toast.error(`${file.name} is not a PNG or JPEG image.`);
      return;
    }
    if (!(await canDecodeImage(bytes, info.mime))) {
      toast.error(`${file.name} could not be read. It may be damaged.`);
      return;
    }
    update({ kind: "image", image: { name: file.name, bytes } });
  };

  const download = async () => {
    if (!ready || !check.ok) return;
    const result = await tool.apply(check.settings, check.pages);
    if (result.status === "watermarked") {
      const name = suffixedPdfName(ready.fileName, "-watermarked");
      downloadBlob(new Blob([result.data], { type: "application/pdf" }), name);
      setAnnouncement(`Saved ${name}.`);
    } else {
      toast.error(result.message);
      setAnnouncement(`Could not add the watermark. ${result.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <BetaNotice title="Beta: what the watermark tool can and cannot do yet">
        <li>
          Text watermarks use the standard PDF fonts (Helvetica, Times,
          Courier), which cover English and other Western European languages,
          not other scripts (such as Devanagari, Chinese or Arabic) or emoji.
          For those, use a picture of the text.
        </li>
        <li>
          The page content is not rewritten: the watermark is added on top of it
          or underneath it. Password-protected PDFs keep their password.
        </li>
        <li>
          Adding a watermark invalidates the PDF&apos;s digital signatures.
        </li>
      </BetaNotice>

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
            ? `Opening ${status.fileName}… The first time, the PDF engines (about 6 MB) are downloaded, so it takes a little longer.`
            : `${status.fileName} is protected with a password.`}
        </p>
      )}

      {status.kind === "needs-password" && (
        <PasswordPrompt
          key={status.fileName}
          fileName={status.fileName}
          wrong={status.wrong}
          note="The watermarked file keeps the same password."
          onSubmit={(password) => void tool.submitPassword(password)}
          onCancel={tool.close}
        />
      )}

      {ready && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <p className="min-w-0 font-medium [overflow-wrap:anywhere]">
              {ready.fileName}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={tool.applying}
                onClick={tool.close}
              >
                <FilePlus2 aria-hidden="true" /> Open another
              </Button>
              <Button
                className="min-h-11"
                disabled={!check.ok || tool.applying}
                aria-describedby={check.ok ? undefined : problemId}
                onClick={() => void download()}
              >
                <Download aria-hidden="true" />
                {tool.applying ? "Adding watermark…" : "Download PDF"}
              </Button>
            </div>
            {!check.ok && (
              <p id={problemId} className="text-destructive w-full text-sm">
                {check.message}
              </p>
            )}
          </div>

          {/* The preview comes first in the page, so on a phone it sits
              above the settings; on wide screens the grid places it in the
              right column, kept in view (sticky) below the site header. */}
          <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-[calc(5rem+env(safe-area-inset-top))] lg:col-start-2 lg:row-start-1 lg:self-start">
              <PreviewPane
                pageCount={ready.pageCount}
                pageIndex={Math.min(pageIndex, ready.pageCount - 1)}
                onPageChange={setPageIndex}
                settings={shownSettings}
                preview={tool.preview}
              />
            </div>
            <div className="lg:col-start-1 lg:row-start-1">
              <SettingsPanel
                form={form}
                onChange={update}
                check={check}
                pageCount={ready.pageCount}
                onPickImage={(file) => void pickImage(file)}
              />
            </div>
          </div>
        </>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
