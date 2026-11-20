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
}

/**
 * Confirm closing a file that has edits not yet downloaded.
 *
 * @param props Whether it is shown, and the two choices.
 * @returns The dialog (renders nothing while closed).
 */
export function DiscardDialog({ open, onKeep, onDiscard }: DiscardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onKeep()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard your edits?</DialogTitle>
          <DialogDescription>
            Your changes have not been downloaded yet. Opening another file
            discards them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onKeep}>
            Keep editing
          </Button>
          <Button
            variant="destructive"
            className="min-h-11"
            onClick={onDiscard}
          >
            Discard edits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
