"use client";

/**
 * File input slot card for either the Original (left) or Revised (right) PDF.
 */
import { FileText, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { isPdfFile } from "@/lib/format";
import type { DocSide } from "./core/model";
import type { SideSlotState } from "./use-pdf-compare";

interface FileSlotProps {
  side: DocSide;
  label: string;
  state: SideSlotState;
  disabled?: boolean;
  onFiles(files: File[]): void;
  onClear(): void;
}

/**
 * Render one upload/status slot for the Original or Revised PDF.
 *
 * @param props Side identifier, heading label, current state, and callbacks.
 * @returns Slot UI card or dropzone.
 */
export function FileSlot({
  side,
  label,
  state,
  disabled = false,
  onFiles,
  onClear,
}: FileSlotProps) {
  const accent =
    side === "left"
      ? "border-l-4 border-l-red-500/70"
      : "border-l-4 border-l-emerald-500/70";

  return (
    <section aria-label={label} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{label}</h2>
        {state.kind === "ready" && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-9 px-2"
            disabled={disabled}
            onClick={onClear}
            aria-label={`Remove ${label}`}
          >
            <X className="size-4" aria-hidden="true" />
            Change
          </Button>
        )}
      </div>

      {state.kind === "failed" && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Could not open {state.fileName}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      {(state.kind === "empty" || state.kind === "failed") && (
        <Dropzone
          accept=".pdf,application/pdf"
          isAccepted={isPdfFile}
          onFiles={onFiles}
          onRejected={(files) =>
            toast.error(
              `Only PDF files are supported. Skipped: ${files.map((f) => f.name).join(", ")}`,
            )
          }
          title={`Drop ${label.toLowerCase()} here`}
          buttonLabel={`Choose ${label}`}
          disabled={disabled}
        />
      )}

      {(state.kind === "opening" || state.kind === "needs-password") && (
        <div className="bg-card space-y-3 rounded-xl border p-4">
          <p role="status" className="text-muted-foreground text-sm">
            {state.kind === "opening"
              ? `${state.fileName}: ${state.stage}`
              : `${state.fileName} is protected with a password.`}
          </p>
          {state.kind === "opening" && (
            <Progress
              value={Math.round(state.progress * 100)}
              aria-label={`Loading ${state.fileName}`}
            />
          )}
        </div>
      )}

      {state.kind === "ready" && (
        <div
          className={`bg-card text-card-foreground flex items-center gap-3 rounded-xl border p-3 ${accent}`}
        >
          <FileText
            className="text-muted-foreground size-5 shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={state.fileName}>
              {state.fileName}
            </p>
            <p className="text-muted-foreground text-xs">
              {state.pageCount} {state.pageCount === 1 ? "page" : "pages"}
              {state.scannedPages > 0 &&
                ` · ${state.scannedPages} without text layer`}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
