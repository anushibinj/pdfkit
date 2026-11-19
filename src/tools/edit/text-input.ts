import { toast } from "sonner";
import type { FontFamily } from "./core/model";
import {
  normalizeTextInput,
  stripUnsupported,
  type FontMetricsSource,
} from "./core/text-layout";

/**
 * Clean text typed into an added text object, telling the user about
 * anything removed.
 *
 * Line breaks and tabs are normalised and characters the standard PDF font
 * cannot show are removed, so what the page shows is exactly what will be
 * saved. Removed characters are reported in a toast (which screen readers
 * announce) rather than next to the field, so nothing shifts while typing.
 *
 * @param raw What the field contains now.
 * @param font The object's font family.
 * @param metrics Font metrics.
 * @returns The text to store.
 */
export function cleanTypedText(
  raw: string,
  font: FontFamily,
  metrics: FontMetricsSource,
): string {
  const cleaned = stripUnsupported(normalizeTextInput(raw), font, metrics);
  if (cleaned.removed.length > 0) {
    const one = cleaned.removed.length === 1;
    toast.warning(
      `Removed ${cleaned.removed.join(" ")}: the standard PDF fonts cannot show ${one ? "this character" : "these characters"}.`,
    );
  }
  return cleaned.text;
}
