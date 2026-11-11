"use client";

import {
  Download,
  FileText,
  RotateCcw,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import { formatBytes } from "@/lib/format";
import { CodeEditor } from "./code-editor";
import { DEFAULT_STYLESHEET, SAMPLE_MARKDOWN } from "./core/default-stylesheet";
import {
  MARKDOWN_ACCEPT,
  isMarkdownFile,
  pdfNameForMarkdown,
} from "./core/file-names";
import { DEFAULT_PAGE_SETUP } from "./core/page-setup";
import type { PageSetup } from "./messages";
import { PageSettings } from "./page-settings";
import { useMarkdownConversion } from "./use-markdown-conversion";

/** Larger Markdown files are refused: layout time grows with length. */
export const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

/**
 * Markdown to PDF tool: open or type Markdown, edit the CSS, pick the paper,
 * then convert and download. All work happens in a Web Worker.
 */
export default function MarkdownTool() {
  const [markdown, setMarkdown] = useState(SAMPLE_MARKDOWN);
  const [css, setCss] = useState(DEFAULT_STYLESHEET);
  const [page, setPage] = useState<PageSetup>(DEFAULT_PAGE_SETUP);
  const [sourceName, setSourceName] = useState<string | undefined>();
  const { state, convert, cancel, inputChanged } = useMarkdownConversion();

  /** Wrap a state setter so every edit also marks the last PDF as stale. */
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      inputChanged();
    };

  const openFiles = async (files: File[]) => {
    const [file] = files;
    if (files.length > 1)
      toast.info(`Opened ${file.name}. One file at a time.`);
    if (file.size > MAX_MARKDOWN_BYTES) {
      toast.error(`${file.name} is over ${formatBytes(MAX_MARKDOWN_BYTES)}.`);
      return;
    }
    try {
      setMarkdown(await file.text());
      setSourceName(file.name);
      inputChanged();
    } catch {
      toast.error(`Could not read ${file.name}.`);
    }
  };

  const converting = state.kind === "converting";
  const announcement =
    state.kind === "converting"
      ? "Creating the PDF…"
      : state.kind === "done"
        ? `PDF ready, ${formatBytes(state.pdf.size)}.`
        : state.kind === "error"
          ? `Could not create the PDF. ${state.message}`
          : "";

  return (
    <div className="space-y-6">
      <Alert
        role="note"
        className="border-yellow-300 bg-yellow-50 text-yellow-950 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-100"
      >
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>Beta: what the PDF engine can and cannot do yet</AlertTitle>
        <AlertDescription className="text-yellow-900 dark:text-yellow-200">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Fonts cover Latin, Greek, Cyrillic, Hebrew and Arabic. Indic
              scripts (such as Devanagari), Chinese, Japanese, Korean and emoji
              do not display correctly yet.
            </li>
            <li>
              Use the font families <code>sans-serif</code>, <code>serif</code>{" "}
              or <code>monospace</code>; other names fall back to one of them.
            </li>
            <li>
              Images that point to the web or to files on your computer are not
              included.
            </li>
          </ul>
        </AlertDescription>
      </Alert>

      <Dropzone
        accept={MARKDOWN_ACCEPT}
        isAccepted={isMarkdownFile}
        onFiles={(files) => void openFiles(files)}
        onRejected={(files) =>
          toast.error(
            `Only Markdown or text files are supported. Skipped: ${files.map((f) => f.name).join(", ")}`,
          )
        }
        title="Drop a Markdown file here"
        buttonLabel="Open Markdown file"
        disabled={converting}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <CodeEditor
          label={sourceName ? `Markdown (${sourceName})` : "Markdown"}
          value={markdown}
          onChange={edit(setMarkdown)}
          placeholder="# Write Markdown here"
        />
        <CodeEditor
          label="CSS"
          value={css}
          onChange={edit(setCss)}
          actions={
            <Button
              variant="outline"
              className="min-h-11"
              disabled={css === DEFAULT_STYLESHEET}
              onClick={() => edit(setCss)(DEFAULT_STYLESHEET)}
            >
              <RotateCcw aria-hidden="true" /> Reset CSS
            </Button>
          }
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageSettings value={page} onChange={edit(setPage)} />
        <div className="flex flex-wrap gap-3">
          {converting ? (
            <Button variant="outline" className="min-h-11" onClick={cancel}>
              <Square aria-hidden="true" /> Cancel
            </Button>
          ) : (
            <Button
              className="min-h-11"
              disabled={markdown.trim() === ""}
              onClick={() => convert({ markdown, css, page })}
            >
              <FileText aria-hidden="true" /> Convert to PDF
            </Button>
          )}
          {state.kind === "done" && (
            <Button
              className="min-h-11"
              onClick={() =>
                downloadBlob(state.pdf, pdfNameForMarkdown(sourceName))
              }
            >
              <Download aria-hidden="true" /> Download PDF (
              {formatBytes(state.pdf.size)})
            </Button>
          )}
        </div>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {converting && (
        <p className="text-muted-foreground text-sm">
          Creating the PDF… The first conversion downloads the PDF engine (about
          15 MB), so it takes a little longer.
        </p>
      )}

      {state.kind === "error" && (
        <Alert variant="destructive">
          <AlertTitle>
            {state.reason === "out-of-memory"
              ? "Out of memory"
              : "Could not create the PDF"}
          </AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
