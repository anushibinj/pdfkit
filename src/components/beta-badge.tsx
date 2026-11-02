import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Green "Beta" pill, shared by the home page cards and the tool pages. */
export function BetaBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200",
        className,
      )}
    >
      Beta
    </Badge>
  );
}
