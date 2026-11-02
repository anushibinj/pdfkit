import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Green "Beta" pill, shared by the home page cards and the tool pages. */
export function BetaBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
        className,
      )}
    >
      Beta
    </Badge>
  );
}
