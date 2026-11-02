import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Progress } from "@/components/ui/progress";

interface FileRowProps {
  name: string;
  /** e.g. "2.4 MB" or "2.4 MB → 2.1 MB" */
  sizeLabel: string;
  status: ReactNode;
  /** 0-100 shows a progress bar; omit to hide it */
  progress?: number;
  /** Extra line under the name (errors, hints) */
  detail?: ReactNode;
  /** Buttons on the right (wraps below on small screens) */
  actions?: ReactNode;
}

export function FileRow({
  name,
  sizeLabel,
  status,
  progress,
  detail,
  actions,
}: FileRowProps) {
  return (
    <li className="rounded-xl border bg-card p-3 text-card-foreground sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FileText
          className="size-6 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate font-medium" title={name}>
            {name}
          </p>
          <p className="text-sm text-muted-foreground">{sizeLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status}
          {actions}
        </div>
      </div>
      {progress !== undefined && (
        <Progress
          value={progress}
          className="mt-3"
          aria-label={`Progress for ${name}`}
        />
      )}
      {detail && <div className="mt-3 text-sm">{detail}</div>}
    </li>
  );
}
