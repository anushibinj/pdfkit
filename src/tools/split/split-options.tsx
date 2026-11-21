"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import type { SplitMethod } from "./core/output-plan";

interface SplitOptionsProps {
  method: SplitMethod;
  onMethodChange(method: SplitMethod): void;
  /** "Pages per file", as typed. */
  everyN: string;
  onEveryNChange(value: string): void;
  /** The typed ranges, one file per item. */
  ranges: string;
  onRangesChange(value: string): void;
  /** Why the current settings make no files, or null. */
  error: string | null;
  disabled?: boolean;
}

/**
 * How to split: every N pages, or by typed ranges (one file per range).
 *
 * The field of the method not in use is disabled, so it is clear which
 * one counts. The plan's error is shown on the active field and announced
 * politely, so typing is not interrupted on every keystroke.
 *
 * @param props The settings and their change handlers.
 * @returns The options.
 */
export function SplitOptions({
  method,
  onMethodChange,
  everyN,
  onEveryNChange,
  ranges,
  onRangesChange,
  error,
  disabled,
}: SplitOptionsProps) {
  const name = useId();
  const errorId = useId();
  const everyId = useId();
  const rangesId = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-medium">How to split</legend>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            checked={method === "every"}
            onChange={() => onMethodChange("every")}
            className="accent-primary size-4"
          />
          Every
        </label>
        <Input
          id={everyId}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={everyN}
          disabled={disabled || method !== "every"}
          onChange={(e) => onEveryNChange(e.target.value)}
          aria-label="Pages per file"
          aria-invalid={method === "every" && error !== null}
          aria-describedby={method === "every" && error ? errorId : undefined}
          className="h-11 w-20 text-base"
        />
        <span className="text-sm">pages per file</span>
      </div>
      <div className="space-y-2">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            checked={method === "ranges"}
            onChange={() => onMethodChange("ranges")}
            className="accent-primary size-4"
          />
          Custom ranges, one file each
        </label>
        <Input
          id={rangesId}
          value={ranges}
          disabled={disabled || method !== "ranges"}
          onChange={(e) => onRangesChange(e.target.value)}
          placeholder="e.g. 1-3, 4-8, 9-"
          aria-label="Ranges, one file each"
          aria-invalid={method === "ranges" && error !== null}
          aria-describedby={method === "ranges" && error ? errorId : undefined}
          autoComplete="off"
          spellCheck={false}
          className="h-11 text-base"
        />
      </div>
      <p id={errorId} aria-live="polite" className="text-destructive min-h-5 text-sm">
        {error}
      </p>
    </fieldset>
  );
}
