"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ConversionState } from "@/lib/html-pdf/conversion-state";
import { formatBytes } from "@/lib/format";

/**
 * The sentence a screen reader announces for a conversion state.
 *
 * @param state The current conversion state.
 * @returns The announcement; empty while idle, so nothing is read out.
 */
export function conversionAnnouncement(state: ConversionState): string {
  switch (state.kind) {
    case "converting":
      return "Creating the PDF…";
    case "done":
      return `PDF ready, ${formatBytes(state.pdf.size)}.`;
    case "error":
      return `Could not create the PDF. ${state.message}`;
    case "idle":
      return "";
  }
}

interface ConversionStatusProps {
  state: ConversionState;
  /** Shown while converting, e.g. that the first run downloads the engine */
  busyMessage: string;
}

/**
 * Progress and failure feedback of a converter page: a polite live region
 * for screen readers, a hint while a conversion runs, and an error alert
 * (titled "Out of memory" when that was the cause, because the remedy is
 * different: a shorter document rather than a retry).
 *
 * @param props The conversion state and the busy hint.
 * @returns The feedback elements.
 */
export function ConversionStatus({
  state,
  busyMessage,
}: ConversionStatusProps) {
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {conversionAnnouncement(state)}
      </div>

      {state.kind === "converting" && (
        <p className="text-muted-foreground text-sm">{busyMessage}</p>
      )}

      {state.kind === "error" && (
        <Alert variant="destructive">
          <AlertTitle>
            {state.reason === "out-of-memory"
              ? "Out of memory"
              : "Could not create the PDF"}
          </AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </>
  );
}
