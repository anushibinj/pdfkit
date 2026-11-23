"use client";

/**
 * Compare PDFs tool page: open two PDFs (Original and Revised), align their
 * pages by text similarity, inspect word-level text differences side by side
 * or pixel-level visual overlays, and export an annotated Comparison Report
 * PDF. All processing runs locally in a Web Worker using PDFium WebAssembly.
 */
import { TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PasswordPrompt } from "@/components/password-prompt";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { downloadBlob } from "@/lib/download";
import { formatBytes } from "@/lib/format";
import {
  buildReportFileName,
  flattenTextChanges,
  stepCyclicIndex,
} from "./compare-navigation";
import { CompareToolbar } from "./compare-toolbar";
import type { CompareMode, DocSide } from "./core/model";
import { FileSlot } from "./file-slot";
import { TextCompareView } from "./text-compare-view";
import { usePdfCompare } from "./use-pdf-compare";
import { VisualCompareView } from "./visual-compare-view";

/** Maximum file size accepted per PDF slot to stay within browser RAM limits. */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/**
 * Compare two PDFs (text and visual) locally in the browser.
 *
 * @returns The Compare PDFs tool client component.
 */
export default function CompareTool() {
  const compare = usePdfCompare();
  const { left, right, summary, reportJob } = compare;

  const [mode, setMode] = useState<CompareMode>("text");
  const [activePairIndex, setActivePairIndex] = useState(0);
  const [activeChangeIndex, setActiveChangeIndex] = useState(-1);
  const [syncScroll, setSyncScroll] = useState(true);
  const [announcement, setAnnouncement] = useState("");

  const allChanges = useMemo(() => flattenTextChanges(summary), [summary]);

  const safePairIndex =
    summary && summary.pairs.length > 0
      ? Math.min(activePairIndex, summary.pairs.length - 1)
      : 0;

  const activeChange =
    activeChangeIndex >= 0 && activeChangeIndex < allChanges.length
      ? allChanges[activeChangeIndex]
      : null;

  const handleFilesForSide = (side: DocSide, files: File[]) => {
    const valid = files.filter((file) => {
      if (file.size > MAX_PDF_BYTES) {
        toast.error(
          `${file.name} is over ${formatBytes(MAX_PDF_BYTES)}. Try a smaller PDF.`,
        );
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;

    if (valid.length >= 2) {
      if (valid.length > 2) {
        toast.info("Opened the first two PDFs for comparison.");
      }
      setActivePairIndex(0);
      setActiveChangeIndex(-1);
      void compare.openFile("left", valid[0]);
      void compare.openFile("right", valid[1]);
      return;
    }

    setActivePairIndex(0);
    setActiveChangeIndex(-1);
    void compare.openFile(side, valid[0]);
  };

  const stepChange = (delta: -1 | 1) => {
    const next = stepCyclicIndex(activeChangeIndex, allChanges.length, delta);
    if (next < 0) return;
    setActiveChangeIndex(next);
    setActivePairIndex(allChanges[next].pairIndex);
    setAnnouncement(
      `Change ${next + 1} of ${allChanges.length}: ${allChanges[next].change.kind}.`,
    );
  };

  const handleExportReport = async () => {
    if (!summary) return;
    const res = await compare.exportReport();
    if (res.status === "report") {
      const name = buildReportFileName(
        summary.leftFileName,
        summary.rightFileName,
      );
      downloadBlob(new Blob([res.data], { type: "application/pdf" }), name);
      setAnnouncement(`Saved ${name}.`);
    } else {
      toast.error(res.message);
    }
  };

  const passwordSide: DocSide | null =
    left.kind === "needs-password"
      ? "left"
      : right.kind === "needs-password"
        ? "right"
        : null;
  const passwordSlot =
    passwordSide === "left"
      ? left
      : passwordSide === "right"
        ? right
        : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FileSlot
          side="left"
          label="Original PDF"
          state={left}
          disabled={reportJob.kind === "building"}
          onFiles={(files) => handleFilesForSide("left", files)}
          onClear={() => {
            setActivePairIndex(0);
            setActiveChangeIndex(-1);
            compare.clearSide("left");
          }}
        />
        <FileSlot
          side="right"
          label="Revised PDF"
          state={right}
          disabled={reportJob.kind === "building"}
          onFiles={(files) => handleFilesForSide("right", files)}
          onClear={() => {
            setActivePairIndex(0);
            setActiveChangeIndex(-1);
            compare.clearSide("right");
          }}
        />
      </div>

      {passwordSide && passwordSlot?.kind === "needs-password" && (
        <PasswordPrompt
          key={`${passwordSide}-${passwordSlot.fileName}`}
          fileName={passwordSlot.fileName}
          wrong={passwordSlot.wrong}
          busy={passwordSlot.busy}
          note="It is used locally to read the PDF for comparison."
          onSubmit={(pw) => void compare.submitPassword(passwordSide, pw)}
          onCancel={() => compare.clearSide(passwordSide)}
        />
      )}

      {summary && (
        <>
          {summary.scannedPagesCount > 0 && (
            <Alert role="note">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>
                {summary.scannedPagesCount}{" "}
                {summary.scannedPagesCount === 1 ? "page has" : "pages have"} no
                extractable text layer
              </AlertTitle>
              <AlertDescription>
                Scanned or image-only pages cannot be compared in Text mode (OCR
                is not included yet). Switch to Visual mode to inspect pixel
                differences on those pages.
              </AlertDescription>
            </Alert>
          )}

          {reportJob.kind === "error" && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>Could not export comparison report</AlertTitle>
              <AlertDescription>{reportJob.message}</AlertDescription>
            </Alert>
          )}

          <CompareToolbar
            summary={summary}
            mode={mode}
            onModeChange={setMode}
            activePairIndex={safePairIndex}
            onPairChange={setActivePairIndex}
            activeChangeIndex={activeChangeIndex}
            totalNavigableChanges={allChanges.length}
            onStepChange={stepChange}
            syncScroll={syncScroll}
            onSyncScrollChange={setSyncScroll}
            reportJob={reportJob}
            onExportReport={() => void handleExportReport()}
            onSwap={() => {
              setActivePairIndex(0);
              setActiveChangeIndex(-1);
              void compare.swapSides();
            }}
            onReset={() => {
              setActivePairIndex(0);
              setActiveChangeIndex(-1);
              compare.resetAll();
            }}
          />

          {mode === "text" ? (
            <TextCompareView
              summary={summary}
              activePairIndex={safePairIndex}
              activeChange={activeChange}
              allChanges={allChanges}
              syncScroll={syncScroll}
              onSelectPair={setActivePairIndex}
              onSelectChange={setActiveChangeIndex}
              renderPage={compare.renderPage}
            />
          ) : (
            <VisualCompareView
              summary={summary}
              activePairIndex={safePairIndex}
              renderPage={compare.renderPage}
              computeVisualDiff={compare.computeVisualDiff}
            />
          )}
        </>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
