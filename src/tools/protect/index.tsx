"use client";

import { Download, Lock, Square, X } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { FileRow } from "@/components/file-row";
import { StartOverButton } from "@/components/start-over-button";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import { formatBytes, isPdfFile, suffixedPdfName } from "@/lib/format";
import { findPasswordPairProblem } from "./core/password-policy";
import { PasswordFields } from "./password-fields";
import type { ProtectionState } from "./protection-state";
import { usePdfProtection } from "./use-pdf-protection";

/** Files above this size get a warning: they are processed in memory. */
export const LARGE_FILE_BYTES = 500 * 1024 * 1024;

/**
 * The status badge for the chosen file.
 *
 * @param props The protection state.
 * @returns A badge.
 */
function StatusFor({ state }: { state: ProtectionState }) {
  switch (state.kind) {
    case "idle":
      return <StatusBadge tone="neutral">Ready</StatusBadge>;
    case "protecting":
      return <StatusBadge tone="busy">Protecting…</StatusBadge>;
    case "done":
      return <StatusBadge tone="success">Protected</StatusBadge>;
    case "already-protected":
      return <StatusBadge tone="warning">Already protected</StatusBadge>;
    case "error":
      return <StatusBadge tone="error">Failed</StatusBadge>;
  }
}

/**
 * Explain that the protected copy's digital signatures no longer verify.
 *
 * @param count How many signatures the original had (at least 1).
 * @returns The sentence, with singular or plural wording.
 */
export function signatureNotice(count: number): string {
  const what =
    count === 1 ? "a digital signature" : `${count} digital signatures`;
  const it = count === 1 ? "it is" : "they are";
  return `This PDF had ${what}. Protecting it rewrites the file, so in the protected copy ${it} no longer valid. Keep the original if you need the signed version.`;
}

/**
 * What screen readers hear when the job's state changes.
 *
 * @param state The protection state.
 * @param name The file's name.
 * @returns The announcement ("" when there is nothing to say).
 */
export function announcementFor(state: ProtectionState, name: string): string {
  switch (state.kind) {
    case "idle":
      return "";
    case "protecting":
      return `Protecting ${name}…`;
    case "done":
      return `${name} is protected. Ready to download.`;
    case "already-protected":
      return `${name} already needs a password to open.`;
    case "error":
      return `Could not protect ${name}. ${state.message}`;
  }
}

/**
 * Protect PDF tool: choose a PDF, type a password twice, and download a copy
 * that needs the password to open. Encryption runs in a Web Worker; the file
 * and the password never leave the device.
 *
 * One file at a time: the password form belongs to the chosen file, and the
 * password stays filled in, so several files can be protected with the same
 * password one after another.
 */
export default function ProtectTool() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const { state, protect, cancel, passwordChanged, fileChanged } =
    usePdfProtection();
  const protecting = state.kind === "protecting";
  const canProtect =
    file !== null &&
    !protecting &&
    findPasswordPairProblem(password, confirmation) === null;

  /**
   * Take the first picked or dropped PDF (one file at a time), warn about
   * very large files, and mark any previous result as stale.
   *
   * @param files The accepted files (the dropzone already filtered non-PDFs).
   */
  const chooseFile = (files: File[]) => {
    const [first] = files;
    if (files.length > 1) {
      toast.info(`Opened ${first.name}. Protect one file at a time.`);
    }
    if (first.size > LARGE_FILE_BYTES) {
      toast.warning(
        `${first.name} is over 500 MB. Processing may be slow or run out of memory.`,
      );
    }
    setFile(first);
    fileChanged();
  };

  /** Forget the chosen file and any result for it. */
  const removeFile = () => {
    setFile(null);
    fileChanged();
  };

  /** Wrap a password setter so every edit also marks the last PDF as stale. */
  const editPassword = (set: (value: string) => void) => (value: string) => {
    set(value);
    passwordChanged();
  };

  /**
   * Start protecting, unless the form is not ready. The disabled button
   * already prevents submitting; the check is repeated so the handler never
   * depends on the markup alone.
   *
   * @param event The form's submit event (its page reload is prevented).
   */
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (file && canProtect) protect(file, password);
  };

  return (
    <div className="space-y-6">
      {!file && (
        <Dropzone
          accept=".pdf,application/pdf"
          isAccepted={isPdfFile}
          onFiles={chooseFile}
          onRejected={(files) =>
            toast.error(
              `Only PDF files are supported. Skipped: ${files.map((f) => f.name).join(", ")}`,
            )
          }
          title="Drop a PDF here"
          buttonLabel="Choose a PDF file"
          disabled={protecting}
        />
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {file ? announcementFor(state, file.name) : ""}
      </div>

      {file && (
        <section aria-label="Protect the PDF" className="space-y-4">
          <div className="flex items-center justify-end">
            <StartOverButton onClick={removeFile} disabled={protecting} />
          </div>
          <ul>
            <FileRow
              name={file.name}
              sizeLabel={
                state.kind === "done"
                  ? `${formatBytes(file.size)} → ${formatBytes(state.pdf.size)}`
                  : formatBytes(file.size)
              }
              status={<StatusFor state={state} />}
              actions={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={`Remove ${file.name}`}
                  disabled={protecting}
                  onClick={removeFile}
                >
                  <X aria-hidden="true" />
                </Button>
              }
              detail={
                <>
                  {file.size > LARGE_FILE_BYTES && (
                    <p className="text-amber-700 dark:text-amber-300">
                      Large file: it is processed in memory and may fail on
                      devices with limited RAM.
                    </p>
                  )}
                  {state.kind === "done" && state.invalidatedSignatures > 0 && (
                    <p className="text-amber-700 dark:text-amber-300">
                      {signatureNotice(state.invalidatedSignatures)}
                    </p>
                  )}
                  {state.kind === "done" && state.replacedRestrictions && (
                    <p className="text-muted-foreground">
                      This PDF had printing, copying or editing restrictions.
                      The protected copy has none: anyone with the password has
                      full access.
                    </p>
                  )}
                  {state.kind === "done" && state.warnings && (
                    <p className="text-muted-foreground">
                      qpdf finished with a warning: {state.warnings}
                    </p>
                  )}
                  {state.kind === "already-protected" && (
                    <p className="text-muted-foreground">
                      This PDF already needs a password to open. To change it,
                      remove the current password with the{" "}
                      <Link
                        href="/tools/unlock/"
                        className="text-foreground underline underline-offset-4"
                      >
                        PDF Unlocker
                      </Link>
                      , then protect the unlocked copy.
                    </p>
                  )}
                  {state.kind === "error" && (
                    <Alert variant="destructive">
                      <AlertTitle>
                        {state.reason === "out-of-memory"
                          ? "Out of memory"
                          : "Could not protect this file"}
                      </AlertTitle>
                      <AlertDescription>{state.message}</AlertDescription>
                    </Alert>
                  )}
                </>
              }
            />
          </ul>

          <form
            onSubmit={submit}
            className="bg-card text-card-foreground space-y-4 rounded-xl border p-3 sm:p-4"
          >
            {/* Locked while protecting, so the PDF being written always
                matches the password shown (see protectionReducer). */}
            <PasswordFields
              password={password}
              confirmation={confirmation}
              onPasswordChange={editPassword(setPassword)}
              onConfirmationChange={editPassword(setConfirmation)}
              disabled={protecting}
            />
            <div className="flex flex-wrap gap-3">
              {protecting ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={cancel}
                >
                  <Square aria-hidden="true" /> Cancel
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={!canProtect}
                >
                  <Lock aria-hidden="true" /> Protect PDF
                </Button>
              )}
              {state.kind === "done" && (
                <Button
                  type="button"
                  className="min-h-11"
                  onClick={() =>
                    downloadBlob(
                      state.pdf,
                      suffixedPdfName(file.name, "-protected"),
                    )
                  }
                >
                  <Download aria-hidden="true" /> Download protected PDF
                </Button>
              )}
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
