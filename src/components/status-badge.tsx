import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "busy" | "success" | "warning" | "error";

const TONES: Record<StatusTone, { icon: LucideIcon; className: string }> = {
  neutral: { icon: Info, className: "" },
  busy: { icon: Loader2, className: "" },
  success: {
    icon: CheckCircle2,
    className:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  },
  warning: {
    icon: Clock,
    className:
      "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  error: {
    icon: AlertCircle,
    className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  },
};

export function StatusBadge({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  const { icon: Icon, className } = TONES[tone];
  return (
    <Badge variant="secondary" className={cn("gap-1", className)}>
      <Icon
        className={cn("size-3", tone === "busy" && "animate-spin")}
        aria-hidden="true"
      />
      {children}
    </Badge>
  );
}
