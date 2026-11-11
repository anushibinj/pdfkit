"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CodeEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Extra controls shown on the label row, e.g. a reset button */
  actions?: ReactNode;
  placeholder?: string;
  className?: string;
}

/**
 * A labelled, monospaced multi-line text field for Markdown or CSS.
 *
 * Spell checking and auto-correction are off because they mangle code
 * (curly quotes in CSS strings, capitalised keywords).
 *
 * @param props Label, controlled value and change handler.
 * @returns The editor element.
 */
export function CodeEditor({
  label,
  value,
  onChange,
  actions,
  placeholder,
  className,
}: CodeEditorProps) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex min-h-11 items-center justify-between gap-2">
        <label htmlFor={id} className="text-lg font-semibold">
          {label}
        </label>
        {actions}
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 min-h-80 w-full flex-1 resize-y rounded-xl border bg-transparent p-3 font-mono text-sm outline-none focus-visible:ring-3"
      />
    </div>
  );
}
