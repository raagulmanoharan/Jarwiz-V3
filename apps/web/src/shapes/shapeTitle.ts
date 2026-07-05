/**
 * The primitive title — one name per shape, shown OUTSIDE the frame when the
 * shape is selected (ui/CardTitleTag) and reused as the ground-chip label in
 * the composer and the grounding title sent to the model. Reads/writes go to
 * wherever each shape already keeps its name (doc/diagram `title`, pdf/image/
 * frame `name`); shapes with no native field (tables, stickies, diagram
 * groups) store it in `shape.meta.jzTitle`, which needs no schema migration
 * and works for any type.
 */

import type { Editor, TLShape, TLShapePartial } from 'tldraw';

const TITLE_PROP = new Set(['doc-card', 'diagram-card', 'link-card', 'youtube-card']);
const NAME_PROP = new Set(['pdf-card', 'image-card', 'frame']);

/** Shape types that carry the outside title tag. Deliberately absent:
 *  stickies and diagrams need no labels (owner call 2026-07-05), and frames
 *  already draw tldraw's own name heading. */
export const TITLED = new Set([
  'doc-card', 'table-card', 'pdf-card', 'image-card', 'link-card', 'youtube-card',
]);

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function getShapeTitle(shape: TLShape): string {
  const p = shape.props as Record<string, unknown>;
  if (TITLE_PROP.has(shape.type)) return str(p.title);
  if (NAME_PROP.has(shape.type)) return str(p.name);
  return str((shape.meta as Record<string, unknown> | undefined)?.jzTitle);
}

export function setShapeTitle(editor: Editor, shape: TLShape, title: string): void {
  // The cross-type partial defeats updateShape's per-type union — safe here
  // because the prop sets above pin which field each type actually has.
  if (TITLE_PROP.has(shape.type)) {
    editor.updateShape({ id: shape.id, type: shape.type, props: { title } } as TLShapePartial);
  } else if (NAME_PROP.has(shape.type)) {
    editor.updateShape({ id: shape.id, type: shape.type, props: { name: title } } as TLShapePartial);
  } else {
    editor.updateShape({ id: shape.id, type: shape.type, meta: { ...shape.meta, jzTitle: title } } as TLShapePartial);
  }
}
