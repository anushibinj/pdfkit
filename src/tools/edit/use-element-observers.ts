"use client";

import { useEffect, useState, type RefObject } from "react";

/** How far outside the screen a page still counts as "near" (and stays rendered). */
export const NEAR_MARGIN = "1500px 0px";

/**
 * Whether an element is on screen or close to it.
 *
 * Pages are rendered only while near the viewport and released when far
 * away, so a 300-page file does not hold 300 full-size bitmaps in memory.
 * Without `IntersectionObserver` (very old browsers, tests) every element
 * counts as near, which is always correct, just less economical.
 *
 * @param ref The element to watch.
 * @param rootMargin How far beyond the viewport counts as near.
 * @returns `true` while the element is near the viewport.
 */
export function useNearViewport(
  ref: RefObject<Element | null>,
  rootMargin = NEAR_MARGIN,
): boolean {
  const [near, setNear] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((e) => e.isIntersecting)),
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  return near;
}

/**
 * An element's current width in CSS pixels (0 until it is measured).
 *
 * `ResizeObserver` reports the first size right after `observe` and then
 * every change. Where it is missing, the width is read once on the next
 * animation frame and again on window resizes.
 *
 * @param ref The element to measure.
 * @returns Its `clientWidth`.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    const frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, [ref]);
  return width;
}
