"use client";

import { X } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PageFieldProps {
  /** E.g. "Pages to extract". */
  label: string;
  value: string;
  onChange(value: string): void;
  onClear(): void;
  /** Why the typed text is not a valid page list, or null. */
  error: string | null;
  disabled?: boolean;
}

/**
 * The typed side of page picking: shows the picked pages ("1-3, 5"), lets
 * people type them instead of clicking, and explains typing mistakes.
 *
 * @param props The text, its error and the handlers.
 * @returns A labelled field with a Clear button.
 */
export function PageField({
  label,
  value,
  onChange,
  onClear,
  error,
  disabled,
}: PageFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. 1-3, 5"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error !== null}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          className="h-11 text-base"
        />
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={disabled || value === ""}
          onClick={onClear}
        >
          <X aria-hidden="true" /> Clear
        </Button>
      </div>
      <p id={hintId} className="text-muted-foreground text-sm">
        Click pages below (Shift-click picks a stretch), or type page numbers.
      </p>
      <p id={errorId} aria-live="polite" className="text-destructive min-h-5 text-sm">
        {error}
      </p>
    </div>
  );
}
