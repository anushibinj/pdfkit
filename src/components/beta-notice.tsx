import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface BetaNoticeProps {
  /** Heading, e.g. "Beta: what the PDF engine can and cannot do yet" */
  title: string;
  /** The limits, as `<li>` elements; they are wrapped in a bulleted list. */
  children: ReactNode;
}

/**
 * Yellow notice listing what a beta tool cannot do yet, shown at the top of
 * the tool. It is a `note` (not an `alert`), so screen readers do not
 * interrupt the user with it on page load.
 *
 * @param props The heading and the list items.
 * @returns The notice element.
 */
export function BetaNotice({ title, children }: BetaNoticeProps) {
  return (
    <Alert
      role="note"
      className="border-yellow-300 bg-yellow-50 text-yellow-950 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-100"
    >
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-yellow-900 dark:text-yellow-200">
        <ul className="list-disc space-y-1 pl-4">{children}</ul>
      </AlertDescription>
    </Alert>
  );
}
