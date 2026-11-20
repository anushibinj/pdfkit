import type { FontMetricsSource } from "../core/text-layout";

/**
 * Test double for font metrics: every ASCII character is exactly 500 units
 * (half an em) wide, ascent 800, descent -200, and anything outside ASCII is
 * "not writable". Round numbers keep expected sizes easy to compute by hand.
 */
export const fakeMetrics: FontMetricsSource = {
  metrics: () => ({
    ascent: 800,
    descent: -200,
    advance: (char: string) =>
      (char.codePointAt(0) ?? 0) < 128 ? 500 : undefined,
  }),
};
