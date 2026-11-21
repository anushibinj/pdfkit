import type { Size } from "@/lib/pdfium/page-box";

/** A page to watermark. */
export interface TargetPage {
  /** 0-based index in the PDF. */
  index: number;
  /** The page's displayed size (see `readPlacementSize`). */
  size: Size;
}

/**
 * Which stamp page goes on which PDF page.
 *
 * The watermark is drawn once per distinct page size into a separate
 * "stamp" PDF; qpdf then lays stamp page `from[k]` onto PDF page `to[k]`.
 * qpdf turns each stamp page into one form XObject and reuses it for every
 * page it is laid on (checked against the real build), so a 300-page
 * document of one size grows by one watermark, not 300.
 */
export interface StampPlan {
  /** One stamp page per distinct size, in order of first use. */
  stamps: Size[];
  /** 0-based PDF page indices, in the order given. */
  to: number[];
  /** For each entry of `to`, the 0-based stamp page laid onto it. */
  from: number[];
}

/** Sizes closer than 1/100 pt share a stamp page. */
const SIZE_PRECISION = 100;

/**
 * A grouping key for a size.
 *
 * Page sizes come from floating point arithmetic (PDFium returns floats), so
 * two A4 pages may differ in the last digits. Rounding to 1/100 pt, far
 * below anything visible, lets them share a stamp page.
 *
 * @param size A page size.
 * @returns For example "595.28x841.89".
 */
export function sizeKey(size: Size): string {
  const r = (n: number) => Math.round(n * SIZE_PRECISION) / SIZE_PRECISION;
  return `${r(size.width)}x${r(size.height)}`;
}

/**
 * Group the pages to watermark by size into stamp pages.
 *
 * @param targets The pages, each with its displayed size.
 * @returns The stamp sizes and the page-to-stamp mapping.
 */
export function planStamps(targets: readonly TargetPage[]): StampPlan {
  const byKey = new Map<string, number>();
  const plan: StampPlan = { stamps: [], to: [], from: [] };
  for (const { index, size } of targets) {
    const key = sizeKey(size);
    let stamp = byKey.get(key);
    if (stamp === undefined) {
      stamp = plan.stamps.length;
      byKey.set(key, stamp);
      plan.stamps.push(size);
    }
    plan.to.push(index);
    plan.from.push(stamp);
  }
  return plan;
}
