"use client";

/**
 * User interface component for the Repair PDF tool.
 *
 * Implements SOLID Principles:
 * - Single Responsibility: Focuses entirely on presentation and user interactions.
 * - Dependency Inversion: Interacts with background workers via the abstract useRepairPdf hook.
 */

import { CheckCircle2, Download, KeyRound, Wrench, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { FileRow } from "@/components/file-row";
import { StartOverButton } from "@/components/start-over-button";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadBlob } from "@/lib/download";
import { formatBytes, isPdfFile, suffixedPdfName } from "@/lib/format";
import { formatRepairSummary } from "./core/report";
import type { RepairState } from "./repair-state";
import { useRepairPdf } from "./use-repair-pdf";

/**
 * Status badge reflecting the current progress of document repair.
 *
 * @param props Props containing the active {@link RepairState}.
 * @returns Status badge component.
 */
export function StatusFor({ state }: { state: RepairState }) {
  switch (state.kind) {
    case "idle":
    case "ready":
      return <StatusBadge tone="neutral">Ready</StatusBadge>;
    case "repairing":
      return <StatusBadge tone="busy">Repairing…</StatusBadge>;
    case "repaired":
      return <StatusBadge tone="success">Repaired</StatusBadge>;
    case "password-required":
      return <StatusBadge tone="warning">Password needed</StatusBadge>;
    case "unrecoverable":
    case "error":
      return <StatusBadge tone="error">Failed</StatusBadge>;
  }
}

/**
 * Repair PDF tool: fixes corrupted, damaged, or unreadable PDF files locally
 * using WebAssembly linear byte carving and cross-reference table reconstruction.
 *
 * All operations run client-side in a Web Worker; files never leave the browser.
 */
export default function RepairTool() {
  const { state, selectFile, repair, cancel, clear } = useRepairPdf();
  const [password, setPassword] = useState("");

  /**
   * Handles file drop or file selection from the dropzone.
   *
   * @param files Array of dropped files.
   */
  const handleDrop = (files: File[]): void => {
    const first = files[0];
    if (!first) return;

    if (!isPdfFile(first)) {
      toast.error("Please choose a PDF file.");
      return;
    }

    setPassword("");
    selectFile(first);
  };

  /**
   * Submits a password to unlock and repair an encrypted damaged document.
   *
   * @param e Form submission event.
   */
  const handlePasswordSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!password) return;
    void repair(password);
  };

  /**
   * Initiates download of the repaired PDF file.
   */
  const handleDownload = (): void => {
    if (state.kind !== "repaired") return;
    const downloadName = suffixedPdfName(state.file.name, "-repaired");
    downloadBlob(state.pdf, downloadName);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {state.kind === "idle" && (
        <Dropzone
          accept=".pdf,application/pdf"
          buttonLabel="Choose PDF file"
          isAccepted={isPdfFile}
          onFiles={handleDrop}
          title="Drop your damaged PDF here"
        />
      )}

      {state.kind !== "idle" && (
        <div className="space-y-4">
          <ul className="space-y-3">
            <FileRow
              actions={
                state.kind !== "repairing" ? (
                  <Button
                    aria-label="Remove file"
                    onClick={clear}
                    size="icon"
                    variant="ghost"
                  >
                    <X className="size-4" />
                  </Button>
                ) : undefined
              }
              name={state.file.name}
              progress={
                state.kind === "repairing"
                  ? Math.round(state.progress * 100)
                  : undefined
              }
              sizeLabel={formatBytes(state.file.size)}
              status={<StatusFor state={state} />}
            />
          </ul>

          {state.kind === "ready" && (
            <div className="flex justify-end gap-3">
              <Button onClick={() => void repair()}>
                <Wrench className="size-4 mr-2" />
                Repair PDF
              </Button>
            </div>
          )}

          {state.kind === "repairing" && (
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-muted-foreground">
                  {state.stage ?? "Reconstructing document structure…"}
                </span>
                <span className="font-mono text-xs">
                  {Math.round(state.progress * 100)}%
                </span>
              </div>
              <div className="flex justify-end">
                <Button onClick={cancel} size="sm" variant="outline">
                  <X className="size-4 mr-1.5" />
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {state.kind === "password-required" && (
            <form
              className="space-y-3 rounded-lg border bg-card p-4"
              onSubmit={handlePasswordSubmit}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-500">
                <KeyRound className="size-4" />
                This document is password protected
              </div>
              <p className="text-xs text-muted-foreground">
                Enter the password to decrypt and repair this PDF document.
              </p>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  className="flex-1"
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter PDF password"
                  type="password"
                  value={password}
                />
                <Button disabled={!password} type="submit">
                  Unlock & Repair
                </Button>
              </div>
            </form>
          )}

          {state.kind === "repaired" && (
            <div className="space-y-4">
              <Alert className="border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100">
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                <AlertTitle>PDF successfully repaired</AlertTitle>
                <AlertDescription className="mt-1 space-y-2 text-xs">
                  <p>{formatRepairSummary(state.report)}</p>
                  {state.report.issues.length > 0 && (
                    <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                      {state.report.issues.map((issue, idx) => (
                        <li key={idx}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </AlertDescription>
              </Alert>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <StartOverButton onClick={clear} />
                <Button onClick={handleDownload} size="lg">
                  <Download className="size-4 mr-2" />
                  Download Repaired PDF
                </Button>
              </div>
            </div>
          )}

          {state.kind === "unrecoverable" && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTitle>Unable to repair document</AlertTitle>
                <AlertDescription className="text-xs">
                  {state.reason}
                </AlertDescription>
              </Alert>
              <div className="flex justify-between">
                <StartOverButton onClick={clear} />
                <Button onClick={() => void repair()} variant="outline">
                  Try Again
                </Button>
              </div>
            </div>
          )}

          {state.kind === "error" && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTitle>Error occurred</AlertTitle>
                <AlertDescription className="text-xs">
                  {state.message}
                </AlertDescription>
              </Alert>
              <div className="flex justify-between">
                <StartOverButton onClick={clear} />
                <Button onClick={() => void repair()} variant="outline">
                  Try Again
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
