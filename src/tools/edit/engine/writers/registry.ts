import type { EditObject, EditObjectKind } from "../../core/model";
import type { FontMetricsSource } from "../../core/text-layout";
import { HighlightWriter, RectWriter } from "./box-writers";
import { ImageWriter } from "./image-writer";
import { InkWriter } from "./ink-writer";
import type { ObjectWriter, WriteContext } from "./object-writer";
import { TextWriter } from "./text-writer";

/** One writer per object kind, typed so each gets only its own kind. */
export type WriterRegistry = {
  [K in EditObjectKind]: ObjectWriter<Extract<EditObject, { kind: K }>>;
};

/**
 * Build the writers. This is the only place that knows every kind: adding
 * a kind means adding one writer class and one line here.
 *
 * @param metrics Font metrics for the text writer.
 * @returns The registry.
 */
export function createWriterRegistry(
  metrics: FontMetricsSource,
): WriterRegistry {
  return {
    text: new TextWriter(metrics),
    ink: new InkWriter(),
    rect: new RectWriter(),
    highlight: new HighlightWriter(),
    image: new ImageWriter(),
  };
}

/**
 * The writer for an object. The cast is safe because the registry's type
 * pairs every kind with a writer for exactly that kind.
 *
 * @param registry All writers.
 * @param object Any object.
 * @returns Its writer.
 */
export function writerFor(
  registry: WriterRegistry,
  object: EditObject,
): ObjectWriter<EditObject> {
  return registry[object.kind] as ObjectWriter<EditObject>;
}

/**
 * Draw a page's objects in list order (bottom-most first).
 *
 * @param registry All writers.
 * @param objects The page's objects.
 * @param ctx The page being edited.
 */
export function writePageObjects(
  registry: WriterRegistry,
  objects: readonly EditObject[],
  ctx: WriteContext,
): void {
  for (const o of objects) writerFor(registry, o).write(o, ctx);
}
