"use client";

/**
 * Visual Compare view: renders both aligned pages at identical DPI, computes
 * per-pixel differences (via GPU WebGL when available, with automatic worker
 * CPU fallback), tints changed pixels, and highlights visual change regions.
 */
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { drawPixels } from "@/lib/draw-pixels";
import { renderWidthFor } from "@/lib/render-width";
import { formatPairLabel } from "./compare-navigation";
import type {
  AlignedPagePair,
  CompareSummary,
  DocSide,
  VisualDiffSummary,
} from "./core/model";
import { DEFAULT_VISUAL_THRESHOLD } from "./core/visual-diff";
import { alignedRenderDimensions } from "./engine/compare-session";
import type { RenderPageResult, VisualDiffResult } from "./messages";
import { renderVisualDiffWebGl } from "./webgl-diff";

type VisualLayout = "overlay" | "side-by-side";

interface VisualCompareViewProps {
  summary: CompareSummary;
  activePairIndex: number;
  renderPage(
    side: DocSide,
    pageIndex: number,
    width: number,
    signal?: AbortSignal,
  ): Promise<RenderPageResult>;
  computeVisualDiff(
    pairIndex: number,
    width: number,
    threshold?: number,
    signal?: AbortSignal,
  ): Promise<VisualDiffResult>;
}

const SENSITIVITY_OPTIONS = [
  { label: "Strict", threshold: 4 },
  { label: "Balanced", threshold: DEFAULT_VISUAL_THRESHOLD },
  { label: "Relaxed", threshold: 36 },
] as const;

/**
 * Render the pixel-level Visual Compare canvas and side-by-side comparison.
 *
 * @param props Comparison summary, active pair index, and worker render/diff callbacks.
 * @returns Visual diff overlay controls, canvas, and detected region list.
 */
export function VisualCompareView({
  summary,
  activePairIndex,
  renderPage,
  computeVisualDiff,
}: VisualCompareViewProps) {
  const pair: AlignedPagePair | undefined = summary.pairs[activePairIndex];
  const [layout, setLayout] = useState<VisualLayout>("overlay");
  const [threshold, setThreshold] = useState<number>(DEFAULT_VISUAL_THRESHOLD);
  const [showRegions, setShowRegions] = useState(true);
  const [activeRegionIdx, setActiveRegionIdx] = useState<number | null>(null);
  const [diffSummary, setDiffSummary] = useState<VisualDiffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [usedWebGl, setUsedWebGl] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!pair) return;
    const controller = new AbortController();
    const cssWidth = stageRef.current?.clientWidth || 720;
    const width = renderWidthFor(
      cssWidth,
      typeof window !== "undefined" ? window.devicePixelRatio : 1,
    );

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setActiveRegionIdx(null);

    const run = async () => {
      const diffRes = await computeVisualDiff(
        pair.pairIndex,
        width,
        threshold,
        controller.signal,
      );
      if (controller.signal.aborted) return;

      if (diffRes.status === "visual-diff") {
        setDiffSummary(diffRes.summary);

        const { leftSize, rightSize } = alignedRenderDimensions(
          pair.leftInfo,
          pair.rightInfo,
          width,
        );

        const [leftRes, rightRes] = await Promise.all([
          pair.leftIndex !== null && leftSize
            ? renderPage("left", pair.leftIndex, leftSize.width, controller.signal)
            : Promise.resolve(null),
          pair.rightIndex !== null && rightSize
            ? renderPage(
                "right",
                pair.rightIndex,
                rightSize.width,
                controller.signal,
              )
            : Promise.resolve(null),
        ]);

        if (controller.signal.aborted) return;

        if (leftRes?.status === "rendered" && leftCanvasRef.current) {
          drawPixels(
            leftCanvasRef.current,
            leftRes.width,
            leftRes.height,
            leftRes.pixels,
          );
        }
        if (rightRes?.status === "rendered" && rightCanvasRef.current) {
          drawPixels(
            rightCanvasRef.current,
            rightRes.width,
            rightRes.height,
            rightRes.pixels,
          );
        }

        const canvas = overlayCanvasRef.current;
        if (canvas) {
          let gpuOk = false;
          if (
            leftRes?.status === "rendered" &&
            rightRes?.status === "rendered"
          ) {
            gpuOk = renderVisualDiffWebGl(canvas, {
              leftPixels: new Uint8Array(leftRes.pixels),
              leftWidth: leftRes.width,
              leftHeight: leftRes.height,
              rightPixels: new Uint8Array(rightRes.pixels),
              rightWidth: rightRes.width,
              rightHeight: rightRes.height,
              threshold,
            });
          }
          setUsedWebGl(gpuOk);
          if (!gpuOk) {
            drawPixels(
              canvas,
              diffRes.summary.width,
              diffRes.summary.height,
              diffRes.pixels,
            );
          }
        }
      }
      setLoading(false);
    };

    void run();
    return () => controller.abort();
  }, [pair, threshold, computeVisualDiff, renderPage]);

  if (!pair) return null;

  const aspect =
    diffSummary && diffSummary.height > 0
      ? `${diffSummary.width} / ${diffSummary.height}`
      : "612 / 792";

  return (
    <div ref={stageRef} className="space-y-5 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Visual layout"
            className="inline-flex rounded-lg border p-0.5"
          >
            <Button
              type="button"
              size="sm"
              variant={layout === "overlay" ? "default" : "ghost"}
              className="min-h-8"
              onClick={() => setLayout("overlay")}
            >
              Pixel overlay
            </Button>
            <Button
              type="button"
              size="sm"
              variant={layout === "side-by-side" ? "default" : "ghost"}
              className="min-h-8"
              onClick={() => setLayout("side-by-side")}
            >
              Side by side + diff
            </Button>
          </div>

          <Button
            type="button"
            size="sm"
            variant={showRegions ? "secondary" : "outline"}
            className="min-h-8"
            onClick={() => setShowRegions((v) => !v)}
          >
            {showRegions ? "Hide region boxes" : "Show region boxes"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground mr-1">Sensitivity:</span>
          {SENSITIVITY_OPTIONS.map((opt) => (
            <Button
              key={opt.label}
              type="button"
              size="sm"
              variant={threshold === opt.threshold ? "secondary" : "ghost"}
              className="min-h-8 px-2.5 text-xs"
              onClick={() => setThreshold(opt.threshold)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {diffSummary && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={diffSummary.changedPixels > 0 ? "default" : "secondary"}>
            {diffSummary.changedPixels > 0
              ? `${diffSummary.percentChanged}% pixels different (${diffSummary.changedPixels.toLocaleString()} px)`
              : "Visually identical"}
          </Badge>
          <Badge variant="outline">
            {diffSummary.regions.length}{" "}
            {diffSummary.regions.length === 1 ? "changed region" : "changed regions"}
          </Badge>
          {diffSummary.sizeMismatch && (
            <Badge variant="outline">
              Different page sizes aligned top-left ({diffSummary.leftWidth}×
              {diffSummary.leftHeight} vs {diffSummary.rightWidth}×
              {diffSummary.rightHeight} px)
            </Badge>
          )}
          <span className="text-muted-foreground ml-auto">
            {formatPairLabel(pair)} · {usedWebGl ? "GPU WebGL diff" : "CPU diff"}
          </span>
        </div>
      )}

      <div
        className={`grid gap-4 ${
          layout === "side-by-side"
            ? "grid-cols-1 lg:grid-cols-3"
            : "mx-auto max-w-3xl grid-cols-1"
        }`}
      >
        {layout === "side-by-side" && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-red-700 dark:text-red-300">
              Original
            </p>
            <div className="overflow-hidden rounded-lg border bg-white">
              {pair.leftIndex !== null ? (
                <canvas ref={leftCanvasRef} className="block h-auto w-full" />
              ) : (
                <p className="text-muted-foreground p-6 text-center text-xs">
                  Added page
                </p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {layout === "side-by-side" && (
            <p className="text-xs font-medium">Visual Difference Overlay</p>
          )}
          <div
            style={{ aspectRatio: aspect }}
            className="relative w-full overflow-hidden rounded-lg border bg-white shadow-xs"
          >
            <canvas
              ref={overlayCanvasRef}
              className="block h-full w-full"
              aria-label={`Visual pixel difference overlay for ${formatPairLabel(pair)}`}
            />
            {loading && (
              <div
                role="status"
                className="bg-background/70 absolute inset-0 flex items-center justify-center text-sm font-medium"
              >
                Comparing pixels…
              </div>
            )}
            {showRegions && diffSummary && (
              <div className="pointer-events-none absolute inset-0">
                {diffSummary.regions.map((reg, idx) => (
                  <div
                    key={idx}
                    className={`absolute rounded-xs border-2 ${
                      activeRegionIdx === idx
                        ? "border-amber-500 bg-amber-400/20"
                        : "border-fuchsia-600/70"
                    }`}
                    style={{
                      left: `${reg.left * 100}%`,
                      top: `${reg.top * 100}%`,
                      width: `${Math.max(0.5, (reg.right - reg.left) * 100)}%`,
                      height: `${Math.max(0.5, (reg.bottom - reg.top) * 100)}%`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            Red = removed ink · Green = added ink · Magenta = colour change ·
            Grey = unchanged
          </p>
        </div>

        {layout === "side-by-side" && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Revised
            </p>
            <div className="overflow-hidden rounded-lg border bg-white">
              {pair.rightIndex !== null ? (
                <canvas ref={rightCanvasRef} className="block h-auto w-full" />
              ) : (
                <p className="text-muted-foreground p-6 text-center text-xs">
                  Removed page
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {diffSummary && diffSummary.regions.length > 0 && (
        <section aria-label="Visual difference regions" className="space-y-2">
          <h3 className="text-sm font-semibold">
            Changed visual regions ({diffSummary.regions.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {diffSummary.regions.map((reg, idx) => (
              <Button
                key={idx}
                type="button"
                size="sm"
                variant={activeRegionIdx === idx ? "default" : "outline"}
                className="min-h-8 text-xs"
                onClick={() =>
                  setActiveRegionIdx((cur) => (cur === idx ? null : idx))
                }
              >
                Region {idx + 1} ({reg.pixelCount.toLocaleString()} px)
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
