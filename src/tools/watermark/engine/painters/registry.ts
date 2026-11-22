import { ImagePainter } from "./image-painter";
import type { PainterRegistry } from "./painter";
import { TextPainter } from "./text-painter";

/**
 * Build the painters. This is the only place that knows every content
 * kind: adding a kind means adding one painter class and one line here.
 *
 * @returns The registry.
 */
export function createPainterRegistry(): PainterRegistry {
  return {
    text: new TextPainter(),
    image: new ImagePainter(),
  };
}
