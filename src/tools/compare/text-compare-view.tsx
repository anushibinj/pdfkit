"use client";

/**
 * Side-by-side Text Compare view with synced scrolling, word-level highlight
 * overlays anchored to exact glyph boxes, and an interactive change list.
 */
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { drawPixels } from "@/lib/draw-pixels";
import { viewSize, type PageInfo } from "@/lib/pdfium/page-box";
import { renderWidthFor } from "@/lib/render-width";
import { formatPairLabel, type FlattenedChange } from "./compare-navigation";
import type {
  AlignedPagePair,
  CompareSummary,
  DocSide,
  NormalizedRect,
  TextChange,
} from "./core/model";
import type { RenderPageResult } from "./messages";

interface TextCompareViewProps {
  summary: CompareSummary;
  activePairIndex: number;
  activeChange: FlattenedChange | null;
  allChanges: readonly FlattenedChange[];
  syncScroll: boolean;
  onSelectPair(pairIndex: number): void;
  onSelectChange(globalIndex: number): void;
  renderPage(
    side: DocSide,
    pageIndex: number,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderPageResult>;
}

interface RenderedPagePaneProps {
  side: DocSide;
  pageIndex: number | null;
  info: PageInfo | null;
  highlights: readonly { changeId: string; rects: readonly NormalizedRect[] }[];
  activeChangeId: string | null;
  placeholderLabel: string;
  renderPage: TextCompareViewProps["renderPage"];
}

/**
 * Renders one PDF page onto a responsive `<canvas>` with normalised highlight
 * overlays positioned over changed words.
 *
 * @param props Page index, geometry, highlight boxes, and worker renderer.
 * @returns Rendered page frame or a matching-aspect placeholder for unmatched pages.
 */
function RenderedPagePane({
  side,
  pageIndex,
  info,
  highlights,
  activeChangeId,
  placeholderLabel,
  renderPage,
}: RenderedPagePaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const view = info ? viewSize(info.box, info.rotation) : null;
  const aspectRatio =
    view && view.height > 0 ? `${view.width} / ${view.height}` : "612 / 792";

  useEffect(() => {
    if (pageIndex === null) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const controller = new AbortController();
    const cssWidth = containerRef.current?.clientWidth || 560;
    const width = renderWidthFor(
      cssWidth,
      typeof window !== "undefined" ? window.devicePixelRatio : 1,
    );

    setRendering(true);
    setRenderError(null);
    void renderPage(side, pageIndex, width, controller.signal).then((res) => {
      if (controller.signal.aborted) return;
      setRendering(false);
      if (res.status === "rendered" && canvasRef.current) {
        drawPixels(canvasRef.current, res.width, res.height, res.pixels);
      } else if (res.status === "error") {
        setRenderError(res.message);
      }
    });

    return () => controller.abort();
  }, [side, pageIndex, renderPage]);

  if (pageIndex === null) {
    return (
      <div
        style={{ aspectRatio }}
        className="border-muted-foreground/30 text-muted-foreground bg-muted/20 flex w-full items-center justify-center rounded-lg border-2 border-dashed p-6 text-center text-sm"
      >
        {placeholderLabel}
      </div>
    );
  }

  const toneClass =
    side === "left"
      ? "bg-red-500/25 border border-red-600/70"
      : "bg-emerald-500/25 border border-emerald-600/70";

  return (
    <div
      ref={containerRef}
      style={{ aspectRatio }}
      className="relative w-full overflow-hidden rounded-lg border bg-white shadow-xs"
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        aria-label={`${side === "left" ? "Original" : "Revised"} page ${pageIndex + 1}`}
      />
      {rendering && (
        <div
          aria-hidden="true"
          className="bg-background/40 pointer-events-none absolute inset-0"
        />
      )}
      {renderError && (
        <div
          role="alert"
          className="bg-background/90 absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-700 dark:text-red-300"
        >
          {renderError}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0">
        {highlights.map(({ changeId, rects }) => {
          const isActive = changeId === activeChangeId;
          return rects.map((r, idx) => (
            <div
              key={`${changeId}-${idx}`}
              data-change-id={changeId}
              className={`absolute rounded-[2px] ${
                isActive
                  ? "bg-amber-400/40 ring-2 ring-amber-500"
                  : toneClass
              }`}
              style={{
                left: `${r.left * 100}%`,
                top: `${r.top * 100}%`,
                width: `${Math.max(0.4, (r.right - r.left) * 100)}%`,
                height: `${Math.max(0.6, (r.bottom - r.top) * 100)}%`,
              }}
            />
          ));
        })}
      </div>
    </div>
  );
}

/**
 * Collect highlight rect groups for one side of an {@link AlignedPagePair}.
 *
 * @param pair Aligned page pair.
 * @param side `"left"` or `"right"`.
 * @returns Highlight items tagged with `changeId`.
 */
function highlightsForSide(
  pair: AlignedPagePair,
  side: DocSide,
): { changeId: string; rects: readonly NormalizedRect[] }[] {
  return pair.changes
    .map((ch) => ({
      changeId: ch.id,
      rects: side === "left" ? ch.leftViewRects : ch.rightViewRects,
    }))
    .filter((item) => item.rects.length > 0);
}

/**
 * Format a compact snippet for one change hunk in the changes sidebar/list.
 *
 * @param change Text change hunk.
 * @returns Short readable summary of removed/inserted words.
 */
export function describeChangeSnippet(change: TextChange): string {
  const clip = (s: string) => (s.length > 72 ? `${s.slice(0, 69)}...` : s);
  if (change.kind === "modified") {
    return `"${clip(change.leftText)}" → "${clip(change.rightText)}"`;
  }
  if (change.kind === "removed") {
    return `Deleted "${clip(change.leftText)}"`;
  }
  return `Inserted "${clip(change.rightText)}"`;
}

/**
 * Render the side-by-side synchronized Text Compare experience.
 *
 * @param props Comparison summary, active cursors, sync scroll setting, and renderer.
 * @returns Side-by-side panes plus clickable change navigator list.
 */
export function TextCompareView({
  summary,
  activePairIndex,
  activeChange,
  allChanges,
  syncScroll,
  onSelectPair,
  onSelectChange,
  renderPage,
}: TextCompareViewProps) {
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const syncDriverRef = useRef<DocSide | null>(null);

  const pair = summary.pairs[activePairIndex];

  useEffect(() => {
    if (!activeChange) return;
    const { id } = activeChange.change;
    const scrollTarget = (container: HTMLDivElement | null) => {
      if (!container) return;
      const el = container.querySelector<HTMLElement>(
        `[data-change-id="${id}"]`,
      );
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    };
    scrollTarget(rightScrollRef.current);
    scrollTarget(leftScrollRef.current);
  }, [activeChange]);

  const handleScroll = (source: DocSide) => {
    if (!syncScroll) return;
    if (syncDriverRef.current && syncDriverRef.current !== source) return;
    const from =
      source === "left" ? leftScrollRef.current : rightScrollRef.current;
    const to =
      source === "left" ? rightScrollRef.current : leftScrollRef.current;
    if (!from || !to) return;

    const maxFrom = from.scrollHeight - from.clientHeight;
    const maxTo = to.scrollHeight - to.clientHeight;
    if (maxFrom <= 0 || maxTo <= 0) return;

    syncDriverRef.current = source;
    to.scrollTop = (from.scrollTop / maxFrom) * maxTo;
    requestAnimationFrame(() => {
      if (syncDriverRef.current === source) syncDriverRef.current = null;
    });
  };

  if (!pair) return null;

  const activeChangeId = activeChange?.change.id ?? null;

  return (
    <div className="space-y-6 pb-10">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs font-medium">
            <span className="truncate text-red-700 dark:text-red-300">
              Original: {summary.leftFileName}
            </span>
            <span className="text-muted-foreground shrink-0">
              {pair.leftIndex !== null
                ? `Page ${pair.leftIndex + 1} of ${summary.leftPageCount}`
                : "No matching page"}
            </span>
          </div>
          <div
            ref={leftScrollRef}
            onScroll={() => handleScroll("left")}
            className="bg-muted/20 max-h-[75vh] overflow-y-auto rounded-xl border p-3"
          >
            <RenderedPagePane
              side="left"
              pageIndex={pair.leftIndex}
              info={pair.leftInfo}
              highlights={highlightsForSide(pair, "left")}
              activeChangeId={activeChangeId}
              placeholderLabel="This page was added in the revised PDF."
              renderPage={renderPage}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs font-medium">
            <span className="truncate text-emerald-700 dark:text-emerald-300">
              Revised: {summary.rightFileName}
            </span>
            <span className="text-muted-foreground shrink-0">
              {pair.rightIndex !== null
                ? `Page ${pair.rightIndex + 1} of ${summary.rightPageCount}`
                : "No matching page"}
            </span>
          </div>
          <div
            ref={rightScrollRef}
            onScroll={() => handleScroll("right")}
            className="bg-muted/20 max-h-[75vh] overflow-y-auto rounded-xl border p-3"
          >
            <RenderedPagePane
              side="right"
              pageIndex={pair.rightIndex}
              info={pair.rightInfo}
              highlights={highlightsForSide(pair, "right")}
              activeChangeId={activeChangeId}
              placeholderLabel="This page was removed from the original PDF."
              renderPage={renderPage}
            />
          </div>
        </div>
      </div>

      <section aria-label="Text changes list" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            All text changes ({allChanges.length})
          </h3>
          <span className="text-muted-foreground text-xs">
            {formatPairLabel(pair)} · {Math.round(pair.similarity * 100)}% page
            text match
          </span>
        </div>

        {allChanges.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border p-4 text-sm">
            No word-level text differences were detected across aligned pages.
            Try Visual mode to inspect layout, images, or drawings.
          </p>
        ) : (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border p-2">
            {allChanges.map((item) => {
              const isSelected = activeChange?.globalIndex === item.globalIndex;
              const itemPair = summary.pairs[item.pairIndex];
              const badgeTone =
                item.change.kind === "added"
                  ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-300"
                  : item.change.kind === "removed"
                    ? "border-red-500/50 text-red-700 dark:text-red-300"
                    : "border-amber-500/50 text-amber-700 dark:text-amber-300";

              return (
                <li key={item.change.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectPair(item.pairIndex);
                      onSelectChange(item.globalIndex);
                    }}
                    className={`hover:bg-muted/60 flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                      isSelected ? "bg-muted ring-primary/40 ring-1" : ""
                    }`}
                  >
                    <Badge variant="outline" className={`shrink-0 ${badgeTone}`}>
                      {item.change.kind}
                    </Badge>
                    <span className="text-muted-foreground shrink-0">
                      {itemPair ? formatPairLabel(itemPair) : ""}
                    </span>
                    <span className="min-w-0 flex-1 break-words">
                      {describeChangeSnippet(item.change)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
