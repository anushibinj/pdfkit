"use client";

import { Popover } from "@base-ui/react/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BetaNote } from "@/tools/types";

interface BetaBadgeProps {
  /** Extended explanation shown in a hover/focus popover. */
  note?: BetaNote;
  className?: string;
}

/**
 * Yellow "Beta" pill, shared by the home page cards and the tool pages.
 * When `note` is provided, hovering (or focusing) the badge opens a popover
 * explaining why the tool is in Beta and what its current limits are.
 */
export function BetaBadge({ note, className }: BetaBadgeProps) {
  const pill = (
    <Badge
      variant="secondary"
      className={cn(
        "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200",
        note && "cursor-help",
        className,
      )}
    >
      Beta
    </Badge>
  );

  if (!note) return pill;

  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={150}
        // Rendered as a span so BetaBadge can sit inside a card <Link> without
        // nesting a <button> inside an <a>.
        nativeButton={false}
        render={<span tabIndex={0} className="inline-flex items-center" />}
      >
        {pill}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} className="z-50">
          <Popover.Popup className="bg-popover text-popover-foreground w-80 max-w-[calc(100vw-2rem)] rounded-xl border p-4 text-xs shadow-lg outline-none">
            <Popover.Title className="mb-2 text-sm font-semibold">
              {note.title}
            </Popover.Title>
            <ul className="text-muted-foreground list-disc space-y-1.5 pl-4">
              {note.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {note.footer && (
              <p className="text-muted-foreground mt-2">{note.footer}</p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
