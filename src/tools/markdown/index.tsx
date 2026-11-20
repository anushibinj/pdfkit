"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BetaNotice } from "@/components/beta-notice";
import { CodeEditor } from "@/components/code-editor";
import { ConversionActions } from "@/components/conversion-actions";
import { ConversionStatus } from "@/components/conversion-status";
import { Dropzone } from "@/components/dropzone";
import { PageSettings } from "@/components/page-settings";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import { DEFAULT_PAGE_SETUP } from "@/lib/html-pdf/page-setup";
import type { PageSetup } from "@/lib/html-pdf/types";
import { readSingleFile } from "@/lib/read-single-file";
import { DEFAULT_STYLESHEET, SAMPLE_MARKDOWN } from "./core/default-stylesheet";
import {
  MARKDOWN_ACCEPT,
  isMarkdownFile,
  pdfNameForMarkdown,
} from "./core/file-names";
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
    const opened = await readSingleFile(
      files,
      MAX_MARKDOWN_BYTES,
      (file) => file.text(),
      toast,
    );
    if (!opened) return;
    setMarkdown(opened.content);
    setSourceName(opened.file.name);
    inputChanged();
  };

  const converting = state.kind === "converting";

  return (
    <div className="space-y-6">
      <BetaNotice title="Beta: what the PDF engine can and cannot do yet">
        <li>
          Fonts cover Latin, Greek, Cyrillic, Hebrew and Arabic. Indic scripts
          (such as Devanagari), Chinese, Japanese, Korean and emoji do not
          display correctly yet.
        </li>
        <li>
          Use the font families <code>sans-serif</code>, <code>serif</code> or{" "}
          <code>monospace</code>; other names fall back to one of them.
        </li>
        <li>
          Images that point to the web or to files on your computer are not
          included.
        </li>
      </BetaNotice>

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
          readOnly={converting}
        />
        <CodeEditor
          label="CSS"
          value={css}
          onChange={edit(setCss)}
          readOnly={converting}
          actions={
            <Button
              variant="outline"
              className="min-h-11"
              disabled={converting || css === DEFAULT_STYLESHEET}
              onClick={() => edit(setCss)(DEFAULT_STYLESHEET)}
            >
              <RotateCcw aria-hidden="true" /> Reset CSS
            </Button>
          }
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        {/* Inputs are locked while converting so the finished PDF always
            matches what the editors show (the reducer keeps a running job's
            result even if input-changed arrives). */}
        <PageSettings
          value={page}
          onChange={edit(setPage)}
          disabled={converting}
        />
        <ConversionActions
          state={state}
          canConvert={markdown.trim() !== ""}
          onConvert={() => convert({ markdown, css, page })}
          onCancel={cancel}
          onDownload={(pdf) =>
            downloadBlob(pdf, pdfNameForMarkdown(sourceName))
          }
        />
      </div>

      <ConversionStatus
        state={state}
        busyMessage="Creating the PDF… The first conversion downloads the PDF engine (about 15 MB), so it takes a little longer."
      />
    </div>
  );
}
