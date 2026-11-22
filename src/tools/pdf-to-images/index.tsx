"use client";

import { FileText, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { PasswordPrompt } from "@/components/password-prompt";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatBytes, isPdfFile } from "@/lib/format";
import { ConversionForm, DEFAULT_SETTINGS } from "./conversion-form";
import { baseNameOf } from "./core/file-names";
import { RunResults } from "./run-results";
import { usePdfToImages } from "./use-pdf-to-images";

/** Larger PDFs are refused: the whole file is held in memory twice. */
export const MAX_PDF_BYTES = 200 * 1024 * 1024;

/**
 * PDF to Images: open a PDF, then either render its pages to PNG or JPEG
 * files, or extract the images embedded in it, and download them one by one
 * or as a ZIP. Everything runs in this tab; the PDF engine lives in a Web
 * Worker.
 *
 * @returns The tool's UI.
 */
export default function PdfToImagesTool() {
  const tool = usePdfToImages();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const { document: doc, run } = tool;
  const running = run.kind === "running";

  const openFiles = (files: File[]) => {
    const [file] = files;
    if (files.length > 1) {
      toast.info(`Opened ${file.name}. One PDF at a time.`);
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error(
        `${file.name} is over ${formatBytes(MAX_PDF_BYTES)}. Try a smaller file.`,
      );
      return;
    }
    // A page selection belongs to the previous file's pages.
    setSettings((current) => ({ ...current, pages: "" }));
    void tool.openFile(file);
  };

  return (
    <div className="space-y-6">
      {doc.kind === "failed" && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Could not open {doc.fileName}</AlertTitle>
          <AlertDescription>{doc.message}</AlertDescription>
        </Alert>
      )}

      {(doc.kind === "empty" || doc.kind === "failed") && (
        <Dropzone
          accept=".pdf,application/pdf"
          isAccepted={isPdfFile}
          onFiles={openFiles}
          onRejected={(files) =>
            toast.error(
              `Only PDF files are supported. Skipped: ${files.map((f) => f.name).join(", ")}`,
            )
          }
          title="Drop a PDF here"
          buttonLabel="Choose a PDF"
        />
      )}

      {(doc.kind === "opening" || doc.kind === "needs-password") && (
        <p role="status" className="text-muted-foreground">
          {doc.kind === "opening"
            ? `Opening ${doc.fileName}… The first time, the PDF engine (about 5 MB) is downloaded, so it takes a little longer.`
            : `${doc.fileName} is protected with a password.`}
        </p>
      )}

      {doc.kind === "needs-password" && (
        <PasswordPrompt
          key={doc.fileName}
          fileName={doc.fileName}
          wrong={doc.wrong}
          onSubmit={(password) => void tool.submitPassword(password)}
          onCancel={tool.closeFile}
        />
      )}

      {doc.kind === "ready" && (
        <>
          <div className="bg-card text-card-foreground flex flex-wrap items-center gap-3 rounded-xl border p-3 sm:p-4">
            <FileText
              className="text-muted-foreground size-6 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 basis-40">
              <p className="truncate font-medium" title={doc.fileName}>
                {doc.fileName}
              </p>
              <p className="text-muted-foreground text-sm">
                {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
              </p>
            </div>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={tool.closeFile}
            >
              Choose another PDF
            </Button>
          </div>

          <ConversionForm
            pageCount={doc.pageCount}
            settings={settings}
            onChange={setSettings}
            running={running}
            stopping={running && run.stopping}
            onConvert={(pages) =>
              void tool.convert(settings.mode, pages, settings.render)
            }
            onStop={tool.stop}
          />

          {run.kind !== "idle" && (
            <RunResults
              run={run}
              baseName={baseNameOf(doc.fileName)}
              pageCount={doc.pageCount}
              onError={(message) => toast.error(message)}
            />
          )}
        </>
      )}
    </div>
  );
}
