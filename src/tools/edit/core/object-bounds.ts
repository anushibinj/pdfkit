import type { EditObject } from "./model";
import { layoutText, type FontMetricsSource } from "./text-layout";

/** An axis-aligned rectangle in an object's local space (v grows down). */
export interface LocalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The area an object covers in its own local space: what the selection
 * outline and the click target use.
 *
 * - Boxes and images: their width and height from the origin.
 * - Text: the laid-out block (widest line, all lines tall).
 * - Ink: the points' bounding box grown by half the pen width on each side,
 *   because a stroke paints half its width beyond its centre line. Points may
 *   lie left of or above the origin, so `x`/`y` can be negative.
 *
 * @param object Any edit object.
 * @param metrics Font metrics, for text.
 * @returns Its local bounds.
 */
export function localBounds(
  object: EditObject,
  metrics: FontMetricsSource,
): LocalRect {
  switch (object.kind) {
    case "text": {
      const layout = layoutText(
        object.text,
        object.font,
        object.fontSize,
        metrics,
      );
      return { x: 0, y: 0, width: layout.width, height: layout.height };
    }
    case "ink": {
      const xs = object.points.map((p) => p.x);
      const ys = object.points.map((p) => p.y);
      const pad = object.strokeWidth / 2;
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      return {
        x,
        y,
        width: Math.max(...xs) + pad - x,
        height: Math.max(...ys) + pad - y,
      };
    }
    default:
      return { x: 0, y: 0, width: object.width, height: object.height };
  }
}
