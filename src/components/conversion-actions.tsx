"use client";

import { Download, FileText, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConversionState } from "@/lib/html-pdf/conversion-state";
import { formatBytes } from "@/lib/format";

interface ConversionActionsProps {
  state: ConversionState;
  /** `false` disables Convert, e.g. while the source text is empty */
  canConvert: boolean;
  onConvert: () => void;
  onCancel: () => void;
  /** Receives the finished PDF when the user clicks Download */
  onDownload: (pdf: Blob) => void;
}

/**
 * The button row of a converter page.
 *
 * While a conversion runs, Convert is replaced by Cancel (so a second job can
 * never be started, and the user can always stop a slow one). Download, with
 * the PDF's size, appears only once a PDF is ready; the state machine removes
 * it again as soon as the input changes, so it never offers a stale file.
 *
 * @param props The conversion state and the three actions.
 * @returns The buttons.
 */
export function ConversionActions({
  state,
  canConvert,
  onConvert,
  onCancel,
  onDownload,
}: ConversionActionsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      {state.kind === "converting" ? (
        <Button variant="outline" className="min-h-11" onClick={onCancel}>
          <Square aria-hidden="true" /> Cancel
        </Button>
      ) : (
        <Button className="min-h-11" disabled={!canConvert} onClick={onConvert}>
          <FileText aria-hidden="true" /> Convert to PDF
        </Button>
      )}
      {state.kind === "done" && (
        <Button className="min-h-11" onClick={() => onDownload(state.pdf)}>
          <Download aria-hidden="true" /> Download PDF (
          {formatBytes(state.pdf.size)})
        </Button>
      )}
    </div>
  );
}
