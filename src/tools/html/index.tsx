"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BetaNotice } from "@/components/beta-notice";
import { CodeEditor } from "@/components/code-editor";
import { ConversionActions } from "@/components/conversion-actions";
import { ConversionStatus } from "@/components/conversion-status";
import { Dropzone } from "@/components/dropzone";
import { PageSettings } from "@/components/page-settings";
import { downloadBlob } from "@/lib/download";
import { DEFAULT_PAGE_SETUP } from "@/lib/html-pdf/page-setup";
import type { PageSetup } from "@/lib/html-pdf/types";
import { readSingleFile } from "@/lib/read-single-file";
import { decodeHtml } from "./core/decode-html";
import { HTML_ACCEPT, isHtmlFile, pdfNameForHtml } from "./core/file-names";
import { SAMPLE_HTML } from "./core/sample-html";
import {
  NO_SKIPPED_RESOURCES,
  scanHtmlForSkippedResources,
} from "./core/skipped-resources";
import { SkippedResourcesNotice } from "./skipped-resources-notice";
import { useHtmlConversion } from "./use-html-conversion";

/**
 * Larger HTML files are refused. HTML files are often bigger than Markdown
 * ones because images are embedded in them as data: URLs, which cost little
 * to lay out; the time a conversion takes grows with the amount of text.
 */
export const MAX_HTML_BYTES = 10 * 1024 * 1024;

/**
 * Read an opened file in the character encoding it declares (see
 * `decodeHtml`), instead of `File.text()`, which always assumes UTF-8.
 *
 * @param file The picked or dropped file.
 * @returns The file's text.
 */
async function readHtmlFile(file: File): Promise<string> {
  return decodeHtml(new Uint8Array(await file.arrayBuffer())).text;
}

/**
 * HTML to PDF tool: open or paste HTML, pick the paper, then convert and
 * download. All work happens in a Web Worker; after converting, the page
 * lists anything the PDF engine had to leave out.
 */
export default function HtmlTool() {
  const [html, setHtml] = useState(SAMPLE_HTML);
  const [page, setPage] = useState<PageSetup>(DEFAULT_PAGE_SETUP);
  const [sourceName, setSourceName] = useState<string | undefined>();
  /** The HTML of the last conversion started, for the "left out" notice. */
  const [convertedHtml, setConvertedHtml] = useState("");
  const { state, convert, cancel, inputChanged } = useHtmlConversion();

  // Scanned once the PDF exists rather than when Convert is pressed, so
  // parsing a large document never delays the start of the conversion.
  // Inputs are locked while converting and any edit afterwards drops the
  // finished PDF, so this always describes the PDF on offer.
  const skipped = useMemo(
    () =>
      state.kind === "done"
        ? scanHtmlForSkippedResources(convertedHtml)
        : NO_SKIPPED_RESOURCES,
    [state.kind, convertedHtml],
  );

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
      MAX_HTML_BYTES,
      readHtmlFile,
      toast,
    );
    if (!opened) return;
    setHtml(opened.content);
    setSourceName(opened.file.name);
    inputChanged();
  };

  const startConversion = () => {
    setConvertedHtml(html);
    convert({ html, page });
  };

  const converting = state.kind === "converting";

  return (
    <div className="space-y-6">
      <BetaNotice title="Beta: what the PDF engine can and cannot do yet">
        <li>
          Only what is inside the HTML is used: CSS in{" "}
          <code>&lt;style&gt;</code> elements and <code>style</code> attributes,
          and PNG or JPEG images embedded as <code>data:</code> URLs. Linked
          stylesheets, images from the web or your computer, and scripts are
          left out; you are told after converting.
        </li>
        <li>
          Fonts cover Latin, Greek, Cyrillic, Hebrew and Arabic, in sans-serif,
          serif and monospace styles (look-alikes of Arial, Times New Roman and
          Courier New); other font families, including web fonts, fall back to
          one of them. Indic scripts (such as Devanagari), Chinese, Japanese,
          Korean and emoji do not display correctly yet.
        </li>
        <li>
          An <code>@page</code> rule in the HTML sets the paper size and
          margins, and overrides the page settings below.
        </li>
      </BetaNotice>

      <Dropzone
        accept={HTML_ACCEPT}
        isAccepted={isHtmlFile}
        onFiles={(files) => void openFiles(files)}
        onRejected={(files) =>
          toast.error(
            `Only HTML files are supported. Skipped: ${files.map((f) => f.name).join(", ")}`,
          )
        }
        title="Drop an HTML file here"
        buttonLabel="Open HTML file"
        disabled={converting}
      />

      <CodeEditor
        label={sourceName ? `HTML (${sourceName})` : "HTML"}
        value={html}
        onChange={edit(setHtml)}
        placeholder="<p>Paste or write HTML here</p>"
        readOnly={converting}
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        {/* Inputs are locked while converting so the finished PDF always
            matches what the editor shows. */}
        <PageSettings
          value={page}
          onChange={edit(setPage)}
          disabled={converting}
        />
        <ConversionActions
          state={state}
          canConvert={html.trim() !== ""}
          onConvert={startConversion}
          onCancel={cancel}
          onDownload={(pdf) => downloadBlob(pdf, pdfNameForHtml(sourceName))}
        />
      </div>

      <ConversionStatus
        state={state}
        busyMessage="Creating the PDF… The first conversion downloads the PDF engine (about 15 MB), so it takes a little longer. Long documents take longer too; you can cancel at any time."
      />

      <SkippedResourcesNotice skipped={skipped} />
    </div>
  );
}
