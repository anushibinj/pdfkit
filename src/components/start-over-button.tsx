import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StartOverButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Compact "Start over" button shown at the top of a tool once a file has been
 * dropped/selected, allowing the user to return to the dropzone.
 */
export function StartOverButton({ onClick, disabled }: StartOverButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onClick}
    >
      <RotateCcw aria-hidden="true" /> Start over
    </Button>
  );
}
