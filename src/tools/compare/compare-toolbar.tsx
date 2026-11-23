"use client";

/**
 * Toolbar for switching between Text and Visual comparison modes, navigating
 * changes, inspecting aligned page pairs, toggling synced scrolling, and
 * exporting the annotated Comparison Report PDF.
 */
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  FileDiff,
  Link2,
  Link2Off,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPairLabel } from "./compare-navigation";
import type { CompareMode, CompareSummary } from "./core/model";
import type { ReportJobState } from "./use-pdf-compare";

interface CompareToolbarProps {
  summary: CompareSummary;
  mode: CompareMode;
  onModeChange(mode: CompareMode): void;
  activePairIndex: number;
  onPairChange(pairIndex: number): void;
  activeChangeIndex: number;
  totalNavigableChanges: number;
  onStepChange(delta: -1 | 1): void;
  syncScroll: boolean;
  onSyncScrollChange(next: boolean): void;
  reportJob: ReportJobState;
  onExportReport(): void;
  onSwap(): void;
  onReset(): void;
}

/**
 * Sticky comparison control bar.
 *
 * @param props Comparison summary, active mode, navigation cursors, and callbacks.
 * @returns Responsive toolbar element.
 */
export function CompareToolbar({
  summary,
  mode,
  onModeChange,
  activePairIndex,
  onPairChange,
  activeChangeIndex,
  totalNavigableChanges,
  onStepChange,
  syncScroll,
  onSyncScrollChange,
  reportJob,
  onExportReport,
  onSwap,
  onReset,
}: CompareToolbarProps) {
  const building = reportJob.kind === "building";
  const currentPair = summary.pairs[activePairIndex];
  const pairCount = summary.pairs.length;

  return (
    <div className="bg-background/95 sticky top-[calc(4rem+env(safe-area-inset-top))] z-30 -mx-4 space-y-3 border-b px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Comparison mode"
          className="inline-flex rounded-lg border p-0.5"
        >
          <Button
            type="button"
            variant={mode === "text" ? "default" : "ghost"}
            size="sm"
            className="min-h-9 gap-1.5"
            aria-pressed={mode === "text"}
            onClick={() => onModeChange("text")}
          >
            <FileDiff className="size-4" aria-hidden="true" />
            Text
          </Button>
          <Button
            type="button"
            variant={mode === "visual" ? "default" : "ghost"}
            size="sm"
            className="min-h-9 gap-1.5"
            aria-pressed={mode === "visual"}
            onClick={() => onModeChange("visual")}
          >
            <Eye className="size-4" aria-hidden="true" />
            Visual
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-normal">
            {summary.totalChanges}{" "}
            {summary.totalChanges === 1 ? "text change" : "text changes"}
          </Badge>
          {summary.addedWords > 0 && (
            <Badge
              variant="outline"
              className="border-emerald-500/50 text-emerald-700 dark:text-emerald-300"
            >
              +{summary.addedWords} added
            </Badge>
          )}
          {summary.removedWords > 0 && (
            <Badge
              variant="outline"
              className="border-red-500/50 text-red-700 dark:text-red-300"
            >
              -{summary.removedWords} removed
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 gap-1.5"
            onClick={onSwap}
            title="Swap Original and Revised PDFs"
          >
            <ArrowLeftRight className="size-4" aria-hidden="true" />
            Swap
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 gap-1.5"
            onClick={onReset}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Start over
          </Button>
          <Button
            type="button"
            size="sm"
            className="min-h-10 gap-1.5"
            disabled={building}
            onClick={onExportReport}
          >
            <Download className="size-4" aria-hidden="true" />
            {building ? "Exporting…" : "Export Report PDF"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9 px-2"
            disabled={activePairIndex <= 0}
            onClick={() => onPairChange(Math.max(0, activePairIndex - 1))}
            aria-label="Previous aligned page"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="text-muted-foreground px-1 text-xs sm:text-sm">
            Pair {activePairIndex + 1} of {pairCount}
            {currentPair ? ` · ${formatPairLabel(currentPair)}` : ""}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9 px-2"
            disabled={activePairIndex >= pairCount - 1}
            onClick={() =>
              onPairChange(Math.min(pairCount - 1, activePairIndex + 1))
            }
            aria-label="Next aligned page"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode === "text" && (
            <Button
              type="button"
              variant={syncScroll ? "secondary" : "outline"}
              size="sm"
              className="min-h-9 gap-1.5"
              aria-pressed={syncScroll}
              onClick={() => onSyncScrollChange(!syncScroll)}
            >
              {syncScroll ? (
                <Link2 className="size-4" aria-hidden="true" />
              ) : (
                <Link2Off className="size-4" aria-hidden="true" />
              )}
              Sync scroll
            </Button>
          )}

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-9 gap-1"
              disabled={totalNavigableChanges === 0}
              onClick={() => onStepChange(-1)}
              aria-label="Previous change"
            >
              <ChevronUp className="size-4" aria-hidden="true" />
              Prev change
            </Button>
            <span className="text-muted-foreground min-w-14 text-center text-xs">
              {totalNavigableChanges > 0 && activeChangeIndex >= 0
                ? `${activeChangeIndex + 1} / ${totalNavigableChanges}`
                : `0 / ${totalNavigableChanges}`}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-9 gap-1"
              disabled={totalNavigableChanges === 0}
              onClick={() => onStepChange(1)}
              aria-label="Next change"
            >
              Next change
              <ChevronDown className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
