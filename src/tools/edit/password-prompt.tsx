"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface PasswordPromptProps {
  fileName: string;
  /** The last password tried was refused. */
  wrong: boolean;
  /** A password is being checked. */
  busy?: boolean;
  onSubmit(password: string): void;
  onCancel(): void;
  /**
   * What happens to the password, after "Enter the password to open X.".
   * Defaults to the editor's wording (the edited file keeps it).
   */
  note?: ReactNode;
  /** Label of the button that gives up on the file. Defaults to "Cancel". */
  cancelLabel?: string;
}

/** The editor's note: the password stays on the device and on the file. */
export const KEEPS_PASSWORD_NOTE =
  "It is used only on this device, and the edited file keeps the same password.";

/**
 * Ask for the password of an encrypted PDF.
 *
 * The password only goes to the PDF engine in this tab's worker. Mount it
 * with `key={fileName}` so the field starts empty for every file.
 *
 * @param props File name, state and callbacks.
 * @returns A modal dialog.
 */
export function PasswordPrompt({
  fileName,
  wrong,
  busy = false,
  onSubmit,
  onCancel,
  note = KEEPS_PASSWORD_NOTE,
  cancelLabel = "Cancel",
}: PasswordPromptProps) {
  const [password, setPassword] = useState("");
  const inputId = useId();
  const errorId = useId();
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length > 0 && !busy) onSubmit(password);
          }}
        >
          <DialogHeader>
            <DialogTitle>Password needed</DialogTitle>
            <DialogDescription className="[overflow-wrap:anywhere] break-words">
              Enter the password to open{" "}
              <span className="text-foreground font-medium break-all">
                {fileName}
              </span>
              . {note}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              Password
            </label>
            <Input
              id={inputId}
              type="password"
              autoComplete="off"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={wrong}
              aria-describedby={wrong ? errorId : undefined}
              className="h-11 text-base"
            />
            {wrong && (
              <p id={errorId} role="alert" className="text-destructive text-sm">
                Wrong password. Check it and try again.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={onCancel}
            >
              {cancelLabel}
            </Button>
            <Button
              type="submit"
              className="min-h-11"
              disabled={password.length === 0 || busy}
            >
              {busy ? "Opening…" : "Open"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
