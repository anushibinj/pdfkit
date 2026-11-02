"use client";

import { useId, useState } from "react";
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

interface PasswordDialogProps {
  fileName: string;
  wrong: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/** Mount with `key={fileId}` so the field resets for each file. */
export function PasswordDialog({
  fileName,
  wrong,
  onSubmit,
  onCancel,
}: PasswordDialogProps) {
  const [password, setPassword] = useState("");
  const inputId = useId();
  const errorId = useId();

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length > 0) onSubmit(password);
          }}
        >
          <DialogHeader>
            <DialogTitle>Password needed</DialogTitle>
            <DialogDescription className="break-words">
              Enter the password to open{" "}
              <span className="font-medium text-foreground">{fileName}</span>.
              It is used only on this device.
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
              <p id={errorId} role="alert" className="text-sm text-destructive">
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
              Skip this file
            </Button>
            <Button
              type="submit"
              className="min-h-11"
              disabled={password.length === 0}
            >
              Unlock
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
