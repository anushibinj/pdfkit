"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RedactionMark } from "./core/model";

export interface ReviewListProps {
  marks: readonly RedactionMark[];
  selectedMarkId: string | null;
  disabled?: boolean;
  onToggle(id: string): void;
  onSelect(mark: RedactionMark): void;
  onRemove(id: string): void;
  onSetAll(enabled: boolean): void;
  onClear(): void;
}

/**
 * Interactive review list of every candidate redaction mark before applying.
 *
 * Users can jump to any mark on its page, untick false positives while keeping
 * them documented for verification, or remove marks entirely.
 *
 * @param props Marks list, selection state, and mutation callbacks.
 * @returns Review list section.
 */
export function ReviewList({
  marks,
  selectedMarkId,
  disabled,
  onToggle,
  onSelect,
  onRemove,
  onSetAll,
  onClear,
}: ReviewListProps) {
  const enabledCount = marks.filter((m) => m.enabled).length;

  return (
    <section
      aria-label="Review marks"
      className="space-y-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Review marks</h2>
          <p className="text-muted-foreground text-xs">
            {marks.length === 0
              ? "Draw a box on the page or run Search & redact."
              : `${enabledCount} of ${marks.length} selected`}
          </p>
        </div>
        {marks.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={disabled}
              onClick={() => onSetAll(enabledCount < marks.length)}
            >
              {enabledCount < marks.length ? "Select all" : "Deselect all"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={disabled}
              onClick={onClear}
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      {marks.length > 0 && (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {marks.map((mark) => {
            const isSelected = mark.id === selectedMarkId;
            return (
              <li
                key={mark.id}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50"
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={`Include mark ${mark.term || mark.label} on page ${mark.pageIndex + 1}`}
                  checked={mark.enabled}
                  disabled={disabled}
                  onChange={() => onToggle(mark.id)}
                  className="accent-primary size-4 shrink-0 rounded border"
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(mark)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    className={`block truncate font-medium ${
                      mark.enabled ? "" : "text-muted-foreground line-through"
                    }`}
                  >
                    {mark.term || "Area redaction"}
                  </span>
                  <span className="text-muted-foreground block text-[11px]">
                    {mark.label} · Page {mark.pageIndex + 1}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label={`Remove mark on page ${mark.pageIndex + 1}`}
                  disabled={disabled}
                  onClick={() => onRemove(mark.id)}
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
