import type {
  EditObject,
  EditorDocument,
  ImageAsset,
  ImageMime,
  QuarterTurns,
  TextEdit,
} from "./model";

/** One output page: which source page, how to turn it, what to add or change. */
export interface SavePage {
  /** Index of the page in the opened file. */
  sourceIndex: number;
  /** Clockwise quarter turns to add to the page's own /Rotate. */
  rotation: QuarterTurns;
  /** Objects to draw, bottom-most first. */
  objects: EditObject[];
  /** New text for lines of the page's own text. */
  textEdits: TextEdit[];
}

/** Image bytes referenced by image objects in the plan. */
export interface SaveImage {
  id: string;
  mime: ImageMime;
  bytes: ArrayBuffer;
}

/**
 * Everything the worker needs to produce the edited file. Pages are listed in
 * output order; source pages that are missing are deleted.
 */
export interface SavePlan {
  pages: SavePage[];
  images: SaveImage[];
}

/**
 * Turn the editor's document into a {@link SavePlan}.
 *
 * Only images that are still used are included: an image that was added and
 * then deleted (or undone) stays in the asset store so redo keeps working,
 * but it must not be sent to the worker for nothing.
 *
 * @param doc The current document.
 * @param assets Every image the user has added, by id.
 * @returns The plan.
 * @throws When an image object points at a missing asset (a bug, since
 *   assets are never removed while the file is open).
 */
export function buildSavePlan(
  doc: EditorDocument,
  assets: ReadonlyMap<string, ImageAsset>,
): SavePlan {
  const used = new Set<string>();
  const pages = doc.pages.map((page) => {
    for (const o of page.objects) if (o.kind === "image") used.add(o.imageId);
    return {
      sourceIndex: page.sourceIndex,
      rotation: page.rotation,
      objects: page.objects,
      textEdits: Object.entries(page.textEdits).map(([runId, text]) => ({
        runId,
        text,
      })),
    };
  });
  const images = [...used].map((id) => {
    const asset = assets.get(id);
    if (!asset) throw new Error(`Missing image ${id}`);
    return { id, mime: asset.mime, bytes: asset.bytes };
  });
  return { pages, images };
}
