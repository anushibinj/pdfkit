"use client";

import { LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BoardPage, BoardSource } from "./core/board";
import { sourceColor } from "./core/source-colors";

/**
 * How many board pages come from each file (duplicates count, deleted
 * pages do not).
 *
 * @param pages The board pages.
 * @returns Page count by source id.
 */
export function pagesPerSource(
  pages: readonly BoardPage[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    if (page.kind === "source")
      counts.set(page.sourceId, (counts.get(page.sourceId) ?? 0) + 1);
  }
  return counts;
}

interface SourceLegendProps {
  sources: readonly BoardSource[];
  pages: readonly BoardPage[];
  disabled: boolean;
  /** Select every board page of this file. */
  onSelectSource(sourceId: string): void;
}

/**
 * The opened files, each with the number and colour its pages carry on the
 * board, how many of its pages are on the board, and a button that selects
 * them (handy for rotating or removing one whole file).
 *
 * A file opened with a password is marked, because the organized file is a
 * new document without one.
 *
 * @param props Files, board pages and the select callback.
 * @returns The legend list.
 */
export function SourceLegend({
  sources,
  pages,
  disabled,
  onSelectSource,
}: SourceLegendProps) {
  const counts = pagesPerSource(pages);
  return (
    <ul aria-label="Files" className="flex flex-wrap gap-2">
      {sources.map((source, i) => {
        const color = sourceColor(source.colorIndex);
        const count = counts.get(source.id) ?? 0;
        return (
          <li
            key={source.id}
            className="bg-card flex max-w-full min-w-0 items-center gap-2 rounded-lg border py-1 pr-1 pl-2 text-sm"
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-xs font-semibold",
                color.fill,
                color.onFill,
              )}
            >
              {i + 1}
            </span>
            <span className="min-w-0 truncate" title={source.name}>
              <span className="sr-only">File {i + 1}: </span>
              {source.name}
            </span>
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {count === 1 ? "1 page" : `${count} pages`}
            </span>
            {source.passwordProtected && (
              <span
                className="text-muted-foreground shrink-0"
                title="Opened with a password; the organized file has no password"
              >
                <LockOpen aria-hidden="true" className="size-4" />
                <span className="sr-only">
                  (opened with a password; the organized file has none)
                </span>
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="min-h-9 shrink-0"
              disabled={disabled || count === 0}
              aria-label={`Select the pages of ${source.name}`}
              onClick={() => onSelectSource(source.id)}
            >
              Select
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
