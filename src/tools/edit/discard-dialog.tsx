"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DiscardDialogProps {
  open: boolean;
  onKeep(): void;
  onDiscard(): void;
  /** Dialog title; defaults to the editor's wording. */
  title?: string;
  /** Explanation under the title; defaults to the editor's wording. */
  description?: string;
  /** Label of the button that keeps the work. */
  keepLabel?: string;
  /** Label of the button that discards it. */
  discardLabel?: string;
}

/**
 * Confirm throwing away work that has not been downloaded yet. The wording
 * defaults to the PDF editor's ("Discard your edits?"); other tools pass
 * their own.
 *
 * @param props Whether it is shown, the two choices and optional wording.
 * @returns The dialog (renders nothing while closed).
 */
export function DiscardDialog({
  open,
  onKeep,
  onDiscard,
  title = "Discard your edits?",
  description = "Your changes have not been downloaded yet. Opening another file discards them.",
  keepLabel = "Keep editing",
  discardLabel = "Discard edits",
}: DiscardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onKeep()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onKeep}>
            {keepLabel}
          </Button>
          <Button
            variant="destructive"
            className="min-h-11"
            onClick={onDiscard}
          >
            {discardLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
