"use client";

import { TriangleAlert } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Dropzone } from "@/components/dropzone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { downloadBlob } from "@/lib/download";
import { formatBytes, isPdfFile, suffixedPdfName } from "@/lib/format";
import { findObject, type ObjectPatch } from "./core/editor-state";
import {
  DEFAULT_TOOL_STYLE,
  moveBy,
  type DrawingTool,
  type ToolStyle,
} from "./core/gestures";
import { MAX_IMAGE_BYTES, readImageInfo } from "./core/image-info";
import type {
  EditObject,
  EditorDocument,
  ImageAsset,
  Point,
  TextEdit,
  TextEditOutcome,
} from "./core/model";
import { addTurns } from "./core/page-geometry";
import { StandardFontMetricsSource } from "./core/standard-font-metrics";
import { describeTextOutcome } from "./core/text-edit-notices";
import { DiscardDialog } from "./discard-dialog";
import { EditorToolbar } from "./editor-toolbar";
import { ObjectProperties } from "./object-properties";
import { PageView } from "./page-view";
import { PasswordPrompt } from "./password-prompt";
import { useEditorShortcuts } from "./use-editor-shortcuts";
import { usePdfEditor } from "./use-pdf-editor";
import { useUnsavedWarning } from "./use-unsaved-warning";

/** Larger PDFs are refused: the whole file is held in memory twice. */
export const MAX_PDF_BYTES = 200 * 1024 * 1024;

/** Tools after which drawing continues (no auto-select, tool stays). */
const DRAWING_TOOLS: ReadonlySet<EditObject["kind"]> = new Set([
  "ink",
  "rect",
  "highlight",
]);

/**
 * PDF editor: open a PDF, change its text in place, add text, drawings,
 * boxes, highlights and images, rotate, reorder or delete pages, then
 * download the result. Everything runs in this tab; the PDF engine lives in
 * a Web Worker.
 */
export default function EditTool() {
  const pdf = usePdfEditor();
  const { status, editor, dispatch } = pdf;
  const metrics = useMemo(() => new StandardFontMetricsSource(), []);
  const [tool, setTool] = useState<DrawingTool>("select");
  const [style, setStyle] = useState<ToolStyle>(DEFAULT_TOOL_STYLE);
  const [pendingImage, setPendingImage] = useState<{
    asset: ImageAsset;
    name: string;
  } | null>(null);
  // The added text object open for typing on the page, if any.
  const [editingObject, setEditingObject] = useState<{
    pageKey: string;
    objectId: string;
  } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [savedDoc, setSavedDoc] = useState<EditorDocument | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const idRef = useRef(0);
  // Text edit notices already shown, so a re-render does not repeat them.
  const noticesShown = useRef(new Set<string>());

  const doc = editor.history.present;
  const ready = status.kind === "ready" ? status : null;
  const selected = findObject(doc, editor.selection) ?? null;
  // Unsaved: something was edited since opening, and it is not exactly what
  // was last downloaded.
  const dirty = editor.history.past.length > 0 && doc !== savedDoc;
  useUnsavedWarning(dirty);

  const newId = useCallback(() => `o${++idRef.current}`, []);

  const resetUi = () => {
    setTool("select");
    setPendingImage(null);
    setEditingObject(null);
    setSavedDoc(null);
    noticesShown.current.clear();
  };

  const openFiles = async (files: File[]) => {
    const [file] = files;
    if (files.length > 1)
      toast.info(`Opened ${file.name}. One file at a time.`);
    if (file.size > MAX_PDF_BYTES) {
      toast.error(
        `${file.name} is over ${formatBytes(MAX_PDF_BYTES)}, too large to edit in the browser.`,
      );
      return;
    }
    resetUi();
    await pdf.openFile(file);
  };

  const closeFile = () => {
    setConfirmClose(false);
    resetUi();
    pdf.close();
  };

  const pickImage = async (file: File) => {
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(`${file.name} is over ${formatBytes(MAX_IMAGE_BYTES)}.`);
      return;
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      toast.error(`Could not read ${file.name}.`);
      return;
    }
    const info = readImageInfo(new Uint8Array(bytes));
    if (!info) {
      toast.error(`${file.name} is not a PNG or JPEG image.`);
      return;
    }
    const asset: ImageAsset = {
      id: `img${++idRef.current}`,
      mime: info.mime,
      bytes,
      pixelWidth: info.width,
      pixelHeight: info.height,
    };
    pdf.addImage(asset);
    dispatch({ type: "select", selection: null });
    setPendingImage({ asset, name: file.name });
  };

  const download = async () => {
    if (!ready) return;
    const saving = doc;
    const result = await pdf.save();
    if (result.status === "saved") {
      const name = suffixedPdfName(ready.fileName, "-edited");
      downloadBlob(new Blob([result.data], { type: "application/pdf" }), name);
      setSavedDoc(saving);
      setAnnouncement(`Saved ${name}.`);
    } else {
      toast.error(result.message);
      setAnnouncement(`Could not save the PDF. ${result.message}`);
    }
  };

  /** Called by a page when the user finished creating an object on it. */
  const addObject = (pageKey: string, object: EditObject) => {
    const keepDrawing = DRAWING_TOOLS.has(object.kind);
    dispatch({ type: "add-object", pageKey, object, select: !keepDrawing });
    // New text opens for typing right where it was placed.
    if (object.kind === "text")
      setEditingObject({ pageKey, objectId: object.id });
    if (object.kind === "image") setPendingImage(null);
    if (!keepDrawing) setTool("select");
  };

  /**
   * Start or stop typing into an added text object on a page. Stopping on
   * a text that is empty (or only spaces) deletes the object: an empty text
   * box would be invisible on the page and dropped when saving anyway.
   */
  const editObject = (pageKey: string, objectId: string | null) => {
    if (objectId !== null) {
      setEditingObject({ pageKey, objectId });
      return;
    }
    if (editingObject?.pageKey === pageKey) {
      const object = findObject(doc, editingObject);
      if (object?.kind === "text" && object.text.trim() === "")
        dispatch({ type: "remove-object", ...editingObject });
      setEditingObject(null);
    }
  };

  /**
   * Tell the user, once per change, when an edit of the PDF's own text did
   * not come out exactly as typed (another font, or characters left out).
   */
  const reportTextOutcomes = (
    pageKey: string,
    edits: readonly TextEdit[],
    outcomes: readonly TextEditOutcome[],
  ) => {
    const sent = new Map(edits.map((e) => [e.runId, e]));
    for (const outcome of outcomes) {
      const edit = sent.get(outcome.runId);
      if (!edit) continue;
      const message = describeTextOutcome(edit, outcome);
      const key = `${pageKey}|${edit.runId}|${edit.text}`;
      if (!message || noticesShown.current.has(key)) continue;
      noticesShown.current.add(key);
      toast.info(message);
    }
  };

  const updateSelected = (patch: ObjectPatch, coalesceKey?: string) => {
    if (!editor.selection) return;
    dispatch({
      type: "update-object",
      pageKey: editor.selection.pageKey,
      objectId: editor.selection.objectId,
      patch,
      coalesceKey,
    });
  };

  const removeSelected = () => {
    if (!editor.selection) return false;
    dispatch({ type: "remove-object", ...editor.selection });
    return true;
  };

  /** Move the selected object by a screen-space distance (arrow keys). */
  const nudge = (delta: Point) => {
    if (!editor.selection || !selected || !ready) return false;
    const page = doc.pages.find((p) => p.key === editor.selection?.pageKey);
    const info = page && ready.pages[page.sourceIndex];
    if (!page || !info) return false;
    const geom = {
      box: info.box,
      turns: addTurns(info.rotation, page.rotation),
    };
    updateSelected(moveBy(selected, delta, geom), `nudge:${selected.id}`);
    return true;
  };

  useEditorShortcuts(ready !== null && !pdf.saving, {
    undo: () => {
      dispatch({ type: "undo" });
      return true;
    },
    redo: () => {
      dispatch({ type: "redo" });
      return true;
    },
    remove: removeSelected,
    nudge,
    // Inline fields handle Escape themselves (and stop it reaching here).
    escape: () => {
      if (pendingImage) setPendingImage(null);
      else if (editor.selection) dispatch({ type: "select", selection: null });
      else if (tool !== "select") setTool("select");
      else return false;
      return true;
    },
  });

  return (
    <div className="space-y-6">
      <Alert
        role="note"
        className="border-yellow-300 bg-yellow-50 text-yellow-950 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-100"
      >
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>Beta: what the editor can and cannot do yet</AlertTitle>
        <AlertDescription className="text-yellow-900 dark:text-yellow-200">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Change the PDF&apos;s own text in place with Edit text: click a
              line and type. The line keeps its font when the file&apos;s font
              has every character you type; otherwise it switches to the closest
              standard font (Helvetica, Times or Courier) in the same place,
              size and colour.
            </li>
            <li>
              Add text, drawings, boxes, highlights and pictures (such as a
              signature); rotate, reorder or delete pages.
            </li>
            <li>
              Text in scanned pages (pictures of text) and in some reused page
              parts cannot be edited. New and substituted text uses the standard
              PDF fonts, which cover English and other Western European
              languages, not other scripts (such as Devanagari, Chinese or
              Arabic) or emoji.
            </li>
            <li>Editing a digitally signed PDF invalidates its signatures.</li>
          </ul>
        </AlertDescription>
      </Alert>

      {status.kind === "failed" && (
        <Alert variant="destructive">
          <AlertTitle>Could not open {status.fileName}</AlertTitle>
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      )}

      {(status.kind === "empty" || status.kind === "failed") && (
        <Dropzone
          accept=".pdf,application/pdf"
          isAccepted={isPdfFile}
          onFiles={(files) => void openFiles(files)}
          onRejected={(files) =>
            toast.error(
              `Only PDF files are supported. Skipped: ${files.map((f) => f.name).join(", ")}`,
            )
          }
          title="Drop a PDF here"
          buttonLabel="Choose a PDF"
        />
      )}

      {(status.kind === "opening" || status.kind === "needs-password") && (
        <p
          role="status"
          className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm"
        >
          {status.kind === "opening"
            ? `Opening ${status.fileName}… The first time, the PDF engine (about 5 MB) is downloaded, so it takes a little longer.`
            : `${status.fileName} is protected with a password.`}
        </p>
      )}

      {status.kind === "needs-password" && (
        <PasswordPrompt
          key={status.fileName}
          fileName={status.fileName}
          wrong={status.wrong}
          onSubmit={(password) => void pdf.submitPassword(password)}
          onCancel={closeFile}
        />
      )}

      {ready && (
        <>
          <div className="bg-background/95 sticky top-[calc(4rem+env(safe-area-inset-top))] z-30 -mx-4 space-y-3 border-b px-4 py-3 backdrop-blur">
            <EditorToolbar
              tool={tool}
              onToolChange={(next) => {
                setTool(next);
                setPendingImage(null);
                dispatch({ type: "select", selection: null });
              }}
              canUndo={editor.history.past.length > 0}
              canRedo={editor.history.future.length > 0}
              onUndo={() => dispatch({ type: "undo" })}
              onRedo={() => dispatch({ type: "redo" })}
              onPickImage={(file) => void pickImage(file)}
              onDownload={() => void download()}
              onClose={() => (dirty ? setConfirmClose(true) : closeFile())}
              saving={pdf.saving}
            />
            <ObjectProperties
              tool={tool}
              style={style}
              onStyleChange={(patch) => setStyle((s) => ({ ...s, ...patch }))}
              selected={selected}
              onUpdate={updateSelected}
              onDelete={removeSelected}
              pendingImageName={pendingImage?.name ?? null}
              onCancelImage={() => setPendingImage(null)}
              metrics={metrics}
            />
          </div>

          <div className="space-y-8 pb-12">
            {doc.pages.map((page, i) => {
              const info = ready.pages[page.sourceIndex];
              return (
                <PageView
                  key={page.key}
                  page={page}
                  info={info}
                  pageNumber={i + 1}
                  pageCount={doc.pages.length}
                  disabled={pdf.saving}
                  tool={tool}
                  style={style}
                  selectedId={
                    editor.selection?.pageKey === page.key
                      ? editor.selection.objectId
                      : null
                  }
                  imageUrls={pdf.images.urls}
                  metrics={metrics}
                  pendingImage={pendingImage?.asset ?? null}
                  newId={newId}
                  onAdd={(object) => addObject(page.key, object)}
                  onUpdate={(objectId, patch, coalesceKey) =>
                    dispatch({
                      type: "update-object",
                      pageKey: page.key,
                      objectId,
                      patch,
                      coalesceKey,
                    })
                  }
                  editingObjectId={
                    editingObject?.pageKey === page.key
                      ? editingObject.objectId
                      : null
                  }
                  onEditObject={(objectId) => editObject(page.key, objectId)}
                  loadTextRuns={pdf.loadTextRuns}
                  onTextEdit={(runId, text, original) =>
                    dispatch({
                      type: "edit-text",
                      pageKey: page.key,
                      runId,
                      text,
                      original,
                    })
                  }
                  onTextOutcomes={(edits, outcomes) =>
                    reportTextOutcomes(page.key, edits, outcomes)
                  }
                  onSelect={(objectId) =>
                    dispatch({
                      type: "select",
                      selection: objectId
                        ? { pageKey: page.key, objectId }
                        : null,
                    })
                  }
                  renderPage={pdf.renderPage}
                  onRotate={(delta) =>
                    dispatch({ type: "rotate-page", pageKey: page.key, delta })
                  }
                  onMove={(delta) =>
                    dispatch({ type: "move-page", pageKey: page.key, delta })
                  }
                  onDelete={() =>
                    dispatch({ type: "delete-page", pageKey: page.key })
                  }
                />
              );
            })}
          </div>
        </>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <DiscardDialog
        open={confirmClose}
        onKeep={() => setConfirmClose(false)}
        onDiscard={closeFile}
      />
    </div>
  );
}
