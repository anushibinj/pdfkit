"use client";

import { useEffect } from "react";

/**
 * Ask the browser to confirm before leaving the page while there are edits
 * that have not been downloaded. Edits live only in this tab's memory, so
 * closing the tab by accident would lose them for good.
 *
 * `preventDefault()` is the standard way to request the prompt; setting
 * `returnValue` as well covers older browsers. Browsers show their own
 * generic message; pages cannot customise it.
 *
 * @param active Whether there is unsaved work.
 */
export function useUnsavedWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
