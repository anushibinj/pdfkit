"use client";

/**
 * Recognized text inspection panel with "Copy text" and ".txt" export actions.
 *
 * Follows Single Responsibility Principle (SRP) by keeping plain-text inspection
 * and clipboard/export interactions cleanly separated from batch queue management.
 */

import { Check, Copy, FileText, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import type { OcrReport } from "./core/model";
import { ocrTxtFileName } from "./core/options";
import { formatOcrSummary } from "./core/report";

export interface TextResultPanelProps {
  fileName: string;
  report: OcrReport;
  onClose(): void;
}

/**
 * Displays recognized plain text for an OCR-processed document with one-click
 * clipboard copy and `.txt` file download.
 *
 * @param props Source filename, OCR report, and close handler.
 * @returns Accessible panel showing recognized text and export buttons.
 */
export function TextResultPanel({
  fileName,
  report,
  onClose,
}: TextResultPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!report.fullText) return;
    try {
      await navigator.clipboard.writeText(report.fullText);
      setCopied(true);
      toast.success("Recognized text copied to clipboard.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy text to clipboard.");
    }
  };

  const handleDownloadTxt = () => {
    const blob = new Blob([report.fullText], {
      type: "text/plain;charset=utf-8",
    });
    downloadBlob(blob, ocrTxtFileName(fileName));
  };

  return (
    <section
      aria-label={`Recognized text for ${fileName}`}
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">
            Recognized text — {fileName}
          </h3>
          <p className="text-muted-foreground text-xs">
            {formatOcrSummary(report)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!report.fullText}
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy text"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!report.fullText}
            onClick={handleDownloadTxt}
          >
            <FileText className="size-4" aria-hidden="true" />
            Download .txt
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Close recognized text panel"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <textarea
        readOnly
        aria-label="Extracted OCR text"
        value={
          report.fullText ||
          "No readable text was detected. Try 300 DPI, enabling scan enhancement, or checking the selected languages."
        }
        rows={8}
        className="border-input bg-muted/30 text-foreground w-full rounded-lg border p-3 font-mono text-xs leading-relaxed outline-none"
      />
    </section>
  );
}
