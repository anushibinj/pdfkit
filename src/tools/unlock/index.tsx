"use client";

import { Download, KeyRound, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { FileRow } from "@/components/file-row";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatBytes, isPdfFile, suffixedPdfName } from "@/lib/format";
import { PasswordDialog } from "./password-dialog";
import { useUnlockQueue, type UnlockItem } from "./use-unlock-queue";

const LARGE_FILE_BYTES = 500 * 1024 * 1024;

function StatusFor({ item }: { item: UnlockItem }) {
  const s = item.state;
  switch (s.kind) {
    case "queued":
      return <StatusBadge tone="neutral">Waiting</StatusBadge>;
    case "processing":
      return <StatusBadge tone="busy">Working…</StatusBadge>;
    case "not-encrypted":
      return <StatusBadge tone="neutral">Not encrypted</StatusBadge>;
    case "needs-password":
      return <StatusBadge tone="warning">Password needed</StatusBadge>;
    case "done":
      return (
        <StatusBadge tone="success">
          {s.via === "owner" ? "Restrictions removed" : "Unlocked"}
        </StatusBadge>
      );
    case "error":
      return <StatusBadge tone="error">Failed</StatusBadge>;
  }
}

export default function UnlockTool() {
  const [announcement, setAnnouncement] = useState("");
  const { items, add, submitPassword, dismissPrompt, reopenPrompt, remove, clear } =
    useUnlockQueue(setAnnouncement);

  // Object URLs only live while a download is being handed to the browser.
  const urlsRef = useRef(new Set<string>());
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const download = (item: UnlockItem) => {
    if (item.state.kind !== "done") return;
    const url = URL.createObjectURL(item.state.blob);
    urlsRef.current.add(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = suffixedPdfName(item.file.name, "-unlocked");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(url);
    }, 1000);
  };

  const onFiles = (files: File[]) => {
    const big = files.filter((f) => f.size > LARGE_FILE_BYTES);
    if (big.length > 0) {
      toast.warning(
        `${big.map((f) => f.name).join(", ")} is over 500 MB. Processing may be slow or run out of memory.`,
      );
    }
    add(files);
  };

  // The first file that still needs a password and was not skipped.
  const promptItem = items.find(
    (i) => i.state.kind === "needs-password" && !i.state.dismissed,
  );

  return (
    <div className="space-y-6">
      <Dropzone
        accept=".pdf,application/pdf"
        isAccepted={isPdfFile}
        onFiles={onFiles}
        onRejected={(files) =>
          toast.error(
            `Only PDF files are supported. Skipped: ${files.map((f) => f.name).join(", ")}`,
          )
        }
      />

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {items.length > 0 && (
        <section aria-label="Files" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Files ({items.length})
            </h2>
            <Button variant="outline" className="min-h-11" onClick={clear}>
              <Trash2 aria-hidden="true" /> Clear all
            </Button>
          </div>
          <ul className="space-y-3">
            {items.map((item) => {
              const s = item.state;
              const original = formatBytes(item.file.size);
              return (
                <FileRow
                  key={item.id}
                  name={item.file.name}
                  sizeLabel={
                    s.kind === "done"
                      ? `${original} → ${formatBytes(s.newSize)}`
                      : original
                  }
                  status={<StatusFor item={item} />}
                  progress={s.kind === "processing" ? s.progress : undefined}
                  actions={
                    <>
                      {s.kind === "done" && (
                        <Button
                          className="min-h-11"
                          onClick={() => download(item)}
                        >
                          <Download aria-hidden="true" /> Download
                        </Button>
                      )}
                      {s.kind === "needs-password" && s.dismissed && (
                        <Button
                          variant="outline"
                          className="min-h-11"
                          onClick={() => reopenPrompt(item.id)}
                        >
                          <KeyRound aria-hidden="true" /> Enter password
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() => remove(item.id)}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </>
                  }
                  detail={
                    <>
                      {item.file.size > LARGE_FILE_BYTES && (
                        <p className="text-amber-700 dark:text-amber-300">
                          Large file: it is processed in memory and may fail on
                          devices with limited RAM.
                        </p>
                      )}
                      {s.kind === "not-encrypted" && (
                        <p className="text-muted-foreground">
                          This PDF is not encrypted, so there is nothing to
                          unlock.
                        </p>
                      )}
                      {s.kind === "done" && s.via === "owner" && (
                        <p className="text-muted-foreground">
                          Opened without a password. Printing, copying and
                          editing restrictions were removed.
                        </p>
                      )}
                      {s.kind === "done" && s.warnings && (
                        <p className="text-muted-foreground">
                          qpdf finished with a warning: {s.warnings}
                        </p>
                      )}
                      {s.kind === "error" && (
                        <Alert variant="destructive">
                          <AlertTitle>
                            {s.reason === "out-of-memory"
                              ? "Out of memory"
                              : "Could not unlock this file"}
                          </AlertTitle>
                          <AlertDescription>{s.message}</AlertDescription>
                        </Alert>
                      )}
                    </>
                  }
                />
              );
            })}
          </ul>
        </section>
      )}

      {promptItem && promptItem.state.kind === "needs-password" && (
        <PasswordDialog
          key={promptItem.id}
          fileName={promptItem.file.name}
          wrong={promptItem.state.wrong}
          onSubmit={(pw) => submitPassword(promptItem.id, pw)}
          onCancel={() => dismissPrompt(promptItem.id)}
        />
      )}
    </div>
  );
}
