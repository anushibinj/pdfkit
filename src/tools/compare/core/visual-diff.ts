/**
 * Pure per-pixel visual difference computation and spatial region clustering.
 */
import type { VisualDiffRegion, VisualDiffSummary } from "./model";

/** Default per-channel RGB tolerance to ignore sub-pixel anti-aliasing jitter. */
export const DEFAULT_VISUAL_THRESHOLD = 14;

/** Pixel size of grid cells used to cluster changed pixels into bounding regions. */
export const DIFF_REGION_CELL_SIZE = 16;

/** Inputs for {@link PixelDiffer.compute}. */
export interface PixelDiffInput {
  pairIndex: number;
  leftPixels: Uint8Array;
  leftWidth: number;
  leftHeight: number;
  rightPixels: Uint8Array;
  rightWidth: number;
  rightHeight: number;
  /** Per-channel delta (`0..255`) below which pixels count as identical. */
  threshold?: number;
}

/** Outputs of {@link PixelDiffer.compute}. */
export interface PixelDiffOutput {
  /** RGBA diff overlay bitmap (`width * height * 4` bytes). */
  pixels: Uint8Array;
  summary: VisualDiffSummary;
}

/** Strategy interface for computing a pixel-level visual diff bitmap and summary. */
export interface PixelDiffer {
  /**
   * Compare two rendered page bitmaps (potentially of different dimensions)
   * aligned at their top-left corners on a white canvas.
   *
   * @param input Left and right RGBA pixel buffers and sizes.
   * @returns Tinted diff RGBA bitmap and summary metrics/regions.
   */
  compute(input: PixelDiffInput): PixelDiffOutput;
}

/**
 * Extract connected bounding boxes from a coarse boolean grid of changed cells
 * using 8-connected breadth-first search.
 *
 * @param cellCounts Changed pixel count per grid cell (`cols * rows`).
 * @param cols Number of grid columns.
 * @param rows Number of grid rows.
 * @param width Full bitmap width in pixels.
 * @param height Full bitmap height in pixels.
 * @param cellSize Side length of each cell in pixels.
 * @returns Normalised `[0..1]` visual diff regions sorted top-to-bottom.
 */
export function extractDiffRegions(
  cellCounts: Uint32Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
  cellSize: number = DIFF_REGION_CELL_SIZE,
): VisualDiffRegion[] {
  const visited = new Uint8Array(cols * rows);
  const regions: VisualDiffRegion[] = [];
  const queue = new Int32Array(cols * rows);

  for (let start = 0; start < cols * rows; start++) {
    if (cellCounts[start] === 0 || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    let minCol = cols;
    let maxCol = 0;
    let minRow = rows;
    let maxRow = 0;
    let pixelCount = 0;

    while (head < tail) {
      const idx = queue[head++];
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
      if (r < minRow) minRow = r;
      if (r > maxRow) maxRow = r;
      pixelCount += cellCounts[idx];

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const nIdx = nr * cols + nc;
          if (!visited[nIdx] && cellCounts[nIdx] > 0) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
      }
    }

    regions.push({
      left: (minCol * cellSize) / width,
      top: (minRow * cellSize) / height,
      right: Math.min(1, ((maxCol + 1) * cellSize) / width),
      bottom: Math.min(1, ((maxRow + 1) * cellSize) / height),
      pixelCount,
    });
  }

  regions.sort((a, b) => a.top - b.top || a.left - b.left);
  return regions;
}

/** Pure CPU/TypedArray implementation of {@link PixelDiffer}. */
export class CpuPixelDiffer implements PixelDiffer {
  /**
   * Compute a per-pixel RGBA diff overlay and change regions.
   *
   * @param input Left and right RGBA images.
   * @returns Diff overlay RGBA buffer and {@link VisualDiffSummary}.
   */
  compute(input: PixelDiffInput): PixelDiffOutput {
    const threshold = input.threshold ?? DEFAULT_VISUAL_THRESHOLD;
    const width = Math.max(1, input.leftWidth, input.rightWidth);
    const height = Math.max(1, input.leftHeight, input.rightHeight);
    const totalPixels = width * height;
    const out = new Uint8Array(totalPixels * 4);

    const cols = Math.ceil(width / DIFF_REGION_CELL_SIZE);
    const rows = Math.ceil(height / DIFF_REGION_CELL_SIZE);
    const cellCounts = new Uint32Array(cols * rows);

    let changedPixels = 0;

    for (let y = 0; y < height; y++) {
      const inLeftY = y < input.leftHeight;
      const inRightY = y < input.rightHeight;
      const cellRow = Math.floor(y / DIFF_REGION_CELL_SIZE);

      for (let x = 0; x < width; x++) {
        const outOffset = (y * width + x) * 4;

        let r1 = 255;
        let g1 = 255;
        let b1 = 255;
        if (inLeftY && x < input.leftWidth) {
          const lo = (y * input.leftWidth + x) * 4;
          r1 = input.leftPixels[lo];
          g1 = input.leftPixels[lo + 1];
          b1 = input.leftPixels[lo + 2];
        }

        let r2 = 255;
        let g2 = 255;
        let b2 = 255;
        if (inRightY && x < input.rightWidth) {
          const ro = (y * input.rightWidth + x) * 4;
          r2 = input.rightPixels[ro];
          g2 = input.rightPixels[ro + 1];
          b2 = input.rightPixels[ro + 2];
        }

        const delta = Math.max(
          Math.abs(r1 - r2),
          Math.abs(g1 - g2),
          Math.abs(b1 - b2),
        );

        if (delta <= threshold) {
          const luma = Math.round(0.299 * r2 + 0.587 * g2 + 0.114 * b2);
          const muted = Math.round(luma * 0.25 + 255 * 0.75);
          out[outOffset] = muted;
          out[outOffset + 1] = muted;
          out[outOffset + 2] = muted;
          out[outOffset + 3] = 255;
          continue;
        }

        changedPixels++;
        const cellCol = Math.floor(x / DIFF_REGION_CELL_SIZE);
        cellCounts[cellRow * cols + cellCol]++;

        const luma1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
        const luma2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;

        const strength = Math.min(1, delta / 128);
        let tr = 192;
        let tg = 38;
        let tb = 211;
        if (luma1 + threshold < luma2) {
          tr = 220;
          tg = 38;
          tb = 38;
        } else if (luma2 + threshold < luma1) {
          tr = 22;
          tg = 163;
          tb = 74;
        }

        out[outOffset] = Math.round(255 * (1 - strength) + tr * strength);
        out[outOffset + 1] = Math.round(255 * (1 - strength) + tg * strength);
        out[outOffset + 2] = Math.round(255 * (1 - strength) + tb * strength);
        out[outOffset + 3] = 255;
      }
    }

    const regions = extractDiffRegions(
      cellCounts,
      cols,
      rows,
      width,
      height,
      DIFF_REGION_CELL_SIZE,
    );

    return {
      pixels: out,
      summary: {
        pairIndex: input.pairIndex,
        width,
        height,
        leftWidth: input.leftWidth,
        leftHeight: input.leftHeight,
        rightWidth: input.rightWidth,
        rightHeight: input.rightHeight,
        sizeMismatch:
          input.leftWidth !== input.rightWidth ||
          input.leftHeight !== input.rightHeight,
        changedPixels,
        totalPixels,
        percentChanged:
          totalPixels > 0
            ? Number(((changedPixels / totalPixels) * 100).toFixed(2))
            : 0,
        regions,
      },
    };
  }
}
