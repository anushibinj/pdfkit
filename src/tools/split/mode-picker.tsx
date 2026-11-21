"use client";

import { FileMinus, FileOutput, Scissors, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import type { ToolMode } from "./core/output-plan";

/** The modes, in the order shown. */
export const MODES: readonly { mode: ToolMode; label: string; icon: LucideIcon }[] = [
  { mode: "split", label: "Split", icon: Scissors },
  { mode: "extract", label: "Extract pages", icon: FileOutput },
  { mode: "remove", label: "Remove pages", icon: FileMinus },
];

interface ModePickerProps {
  mode: ToolMode;
  onChange(mode: ToolMode): void;
  disabled?: boolean;
}

/**
 * Choose what to do with the PDF.
 *
 * Built from native radio buttons (visually hidden, styled through their
 * labels), so keyboard behaviour comes from the browser: Tab reaches the
 * group, arrow keys move between modes, and screen readers announce
 * "radio button, 2 of 3".
 *
 * @param props The current mode and the change handler.
 * @returns A segmented control.
 */
export function ModePicker({ mode, onChange, disabled }: ModePickerProps) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">What to do</legend>
      <div className="bg-muted grid grid-cols-3 gap-1 rounded-xl p-1">
        {MODES.map(({ mode: value, label, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-2 text-center text-sm font-medium transition-colors",
              "has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3",
              value === mode
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={value === mode}
              onChange={() => onChange(value)}
              className="sr-only"
            />
            <Icon className="hidden size-4 shrink-0 sm:block" aria-hidden="true" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
