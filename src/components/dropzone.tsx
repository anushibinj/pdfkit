"use client";

import { FileUp } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DropzoneProps {
  onFiles: (files: File[]) => void;
  /** Value for the input's accept attribute, e.g. ".pdf,application/pdf" */
  accept: string;
  /** Predicate to filter dropped files (drops ignore `accept`) */
  isAccepted: (file: File) => boolean;
  /** Called with rejected files so the caller can tell the user */
  onRejected?: (files: File[]) => void;
  title?: string;
  hint?: string;
  buttonLabel?: string;
  disabled?: boolean;
}

export function Dropzone({
  onFiles,
  accept,
  isAccepted,
  onRejected,
  title = "Drop PDF files here",
  hint = "Files stay on your device. Nothing is uploaded.",
  buttonLabel = "Choose PDF files",
  disabled,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);

  const handle = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const all = Array.from(list);
    const ok = all.filter(isAccepted);
    const bad = all.filter((f) => !isAccepted(f));
    if (bad.length > 0) onRejected?.(bad);
    if (ok.length > 0) onFiles(ok);
  };

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) handle(e.dataTransfer.files);
      }}
      className={cn(
        "flex min-h-56 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-6 text-center transition-colors",
        dragging
          ? "border-primary bg-primary/5"
          : "border-border bg-muted/30",
      )}
    >
      <FileUp className="size-10 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-lg font-medium">{title}</p>
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = ""; // allow picking the same file again
        }}
      />
      <Button
        size="lg"
        className="min-h-11 w-full px-6 text-base sm:w-auto"
        disabled={disabled}
        aria-describedby={hintId}
        onClick={() => inputRef.current?.click()}
      >
        {buttonLabel}
      </Button>
      <p className="hidden text-sm text-muted-foreground sm:block">
        or drag and drop
      </p>
    </div>
  );
}
