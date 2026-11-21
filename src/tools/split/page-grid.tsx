"use client";

import type { PageSize, RenderResult } from "./messages";
import { PageThumbnail, type ThumbnailMark } from "./page-thumbnail";

interface PageGridProps {
  pages: readonly PageSize[];
  renderPage(pageIndex: number, width: number, signal?: AbortSignal): Promise<RenderResult>;
  /** Names the grid for screen readers, e.g. "Pick pages to remove". */
  label: string;
  /** How each page is marked, by page index. */
  markOf(pageIndex: number): ThumbnailMark;
  /** A caption per page (split mode), or nothing. */
  captionOf?(pageIndex: number): string | undefined;
  /** Makes pages clickable (extract and remove). */
  onToggle?(pageIndex: number, extend: boolean): void;
  disabled?: boolean;
}

/**
 * Every page of the PDF as a thumbnail, in a responsive grid: two columns
 * on a phone, up to six on a wide screen.
 *
 * @param props The pages and how to show and pick them.
 * @returns A labelled list of pages.
 */
export function PageGrid({
  pages,
  renderPage,
  label,
  markOf,
  captionOf,
  onToggle,
  disabled,
}: PageGridProps) {
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
    >
      {pages.map((size, i) => (
        <PageThumbnail
          key={i}
          pageIndex={i}
          size={size}
          renderPage={renderPage}
          mark={markOf(i)}
          caption={captionOf?.(i)}
          onToggle={onToggle}
          disabled={disabled}
        />
      ))}
    </ul>
  );
}
