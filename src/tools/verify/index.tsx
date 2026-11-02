"use client";

import { Download, ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { FileRow } from "@/components/file-row";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatBytes, isPdfFile, suffixedPdfName } from "@/lib/format";
import { WorkerClient } from "@/lib/worker-client";
import type {
  SignatureReport,
  StampResult,
  VerifyResult,
  WorkerRequestPayload,
  WorkerResultPayload,
} from "./messages";

type ItemState =
  | { kind: "checking" }
  | { kind: "unsigned" }
  | {
      kind: "checked";
      signatures: SignatureReport[];
      allValid: boolean;
      data: ArrayBuffer;
    }
  | { kind: "error"; message: string };

interface Item {
  id: string;
  file: File;
  state: ItemState;
  stamping?: boolean;
}

function Detail({ s }: { s: SignatureReport }) {
  const label =
    s.status === "valid"
      ? "Valid"
      : s.status === "invalid"
        ? "Invalid"
        : "Cannot check";
  return (
    <li>
      <span className="font-medium">
        Signature {s.index + 1}: {label}
      </span>
      {s.signer && <> · {s.signer}</>}
      {s.reason && <> · {s.reason}</>}
      {s.status === "valid" && !s.coversWholeFile && (
        <> · changes were saved after this signature (e.g. a later signature)</>
      )}
    </li>
  );
}

export default function VerifyTool() {
  const [items, setItems] = useState<Item[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const clientRef = useRef<WorkerClient<
    WorkerRequestPayload,
    WorkerResultPayload
  > | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    const client = new WorkerClient<WorkerRequestPayload, WorkerResultPayload>(
      () =>
        new Worker(new URL("./worker/verify.worker.ts", import.meta.url), {
          type: "module",
        }),
    );
    clientRef.current = client;
    return () => {
      client.terminate();
      clientRef.current = null;
    };
  }, []);

  const patch = useCallback((id: string, change: Partial<Item>) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...change } : i)));
  }, []);

  const check = useCallback(
    async (id: string, file: File) => {
      const client = clientRef.current;
      if (!client) return;
      try {
        const data = await file.arrayBuffer();
        const res = (await client.request(
          { op: "verify", data },
          { transfer: [data] },
        )) as VerifyResult;
        if (res.status === "no-signatures") {
          patch(id, { state: { kind: "unsigned" } });
          setAnnouncement(`${file.name} has no digital signatures.`);
        } else if (res.status === "checked") {
          patch(id, {
            state: {
              kind: "checked",
              signatures: res.signatures,
              allValid: res.allValid,
              data: res.data,
            },
          });
          setAnnouncement(
            res.allValid
              ? `${file.name}: all signatures valid.`
              : `${file.name}: a signature is not valid.`,
          );
        } else {
          patch(id, { state: { kind: "error", message: res.message } });
        }
      } catch (err) {
        if (clientRef.current !== client) return;
        patch(id, {
          state: {
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },
    [patch],
  );

  const onFiles = (files: File[]) => {
    const added: Item[] = files.map((file) => ({
      id: `v${++idRef.current}`,
      file,
      state: { kind: "checking" },
    }));
    setItems((cur) => [...cur, ...added]);
    // The worker handles messages in order, so firing all requests is fine.
    for (const a of added) void check(a.id, a.file);
  };

  const downloadStamped = async (item: Item) => {
    const client = clientRef.current;
    if (!client || item.state.kind !== "checked" || !item.state.allValid) return;
    const { data, signatures } = item.state;
    patch(item.id, { stamping: true });
    try {
      const res = (await client.request(
        {
          op: "stamp",
          data: data.slice(0), // keep the original for another export
          signatureCount: signatures.length,
          verifiedAt: new Date().toISOString(),
        },
        { transfer: [] },
      )) as StampResult;
      if (res.status !== "stamped") throw new Error(res.message);
      const url = URL.createObjectURL(
        new Blob([res.data], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = suffixedPdfName(item.file.name, "-verified");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(
        `Could not add the tick: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      patch(item.id, { stamping: false });
    }
  };

  return (
    <div className="space-y-6">
      <Alert
        role="note"
        className="border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
      >
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>Beta: signature checks are limited for now</AlertTitle>
        <AlertDescription className="text-emerald-900 dark:text-emerald-200">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              We check that the signed content is unchanged and that the
              signature is cryptographically correct.
            </li>
            <li>
              We do not yet check who signed. Certificates are not validated
              against a trusted list (such as Adobe or EU trust lists) or for
              revocation, so a green tick means &ldquo;signature intact&rdquo;,
              not &ldquo;signer trusted&rdquo;.
            </li>
            <li>
              The tick is added as an annotation after the original signature.
              The signature stays valid, but some PDF readers will report a
              change made after signing.
            </li>
          </ul>
          <p className="mt-2">
            We are working on full certificate and revocation checks.
          </p>
        </AlertDescription>
      </Alert>

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
            <h2 className="text-lg font-semibold">Files ({items.length})</h2>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setItems([])}
            >
              <Trash2 aria-hidden="true" /> Clear all
            </Button>
          </div>
          <ul className="space-y-3">
            {items.map((item) => {
              const s = item.state;
              return (
                <FileRow
                  key={item.id}
                  name={item.file.name}
                  sizeLabel={formatBytes(item.file.size)}
                  status={
                    s.kind === "checking" ? (
                      <StatusBadge tone="busy">Checking…</StatusBadge>
                    ) : s.kind === "unsigned" ? (
                      <StatusBadge tone="neutral">Not signed</StatusBadge>
                    ) : s.kind === "error" ? (
                      <StatusBadge tone="error">Failed</StatusBadge>
                    ) : s.allValid ? (
                      <StatusBadge tone="success">Signature valid</StatusBadge>
                    ) : (
                      <StatusBadge tone="error">Not valid</StatusBadge>
                    )
                  }
                  actions={
                    <>
                      {s.kind === "checked" && s.allValid && (
                        <Button
                          className="min-h-11"
                          disabled={item.stamping}
                          onClick={() => void downloadStamped(item)}
                        >
                          <Download aria-hidden="true" />{" "}
                          {item.stamping ? "Adding tick…" : "Download with tick"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() =>
                          setItems((cur) => cur.filter((i) => i.id !== item.id))
                        }
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </>
                  }
                  detail={
                    <>
                      {s.kind === "unsigned" && (
                        <p className="text-muted-foreground">
                          No digital signatures found in this PDF.
                        </p>
                      )}
                      {s.kind === "checked" && (
                        <ul className="space-y-1 text-muted-foreground">
                          {s.signatures.map((sig) => (
                            <Detail key={sig.index} s={sig} />
                          ))}
                        </ul>
                      )}
                      {s.kind === "checked" && !s.allValid && (
                        <p className="flex items-center gap-1 text-red-700 dark:text-red-300">
                          <ShieldCheck className="size-4" aria-hidden="true" />
                          No tick is added unless every signature is valid.
                        </p>
                      )}
                      {s.kind === "error" && (
                        <Alert variant="destructive">
                          <AlertTitle>Could not check this file</AlertTitle>
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
    </div>
  );
}
