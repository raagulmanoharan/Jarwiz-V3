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
 *  stickies and diagrams need no labels (owner call 2026-07-05), frames
 *  already draw tldraw's own name heading, and video cards show their title
 *  in the header itself (owner call 2026-07-05 — no duplicate tag). Video
 *  stays in TITLE_PROP above so grounding/search still read its title. */
export const TITLED = new Set([
  'doc-card', 'table-card', 'pdf-card', 'image-card', 'link-card',
]);

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function getShapeTitle(shape: TLShape): string {
  const p = shape.props as Record<string, unknown>;
  if (TITLE_PROP.has(shape.type)) return str(p.title);
  if (NAME_PROP.has(shape.type)) return str(p.name);
  return str((shape.meta as Record<string, unknown> | undefined)?.jzTitle);
}

export function setShapeTitle(editor: Editor, shape: TLShape, title: string): void {
  // A title typed into the tag is MANUAL — auto-derivation (below) must never
  // overwrite it. Clearing the tag hands the title back to auto.
  const meta = { ...shape.meta, jzTitleAuto: false };
  // The cross-type partial defeats updateShape's per-type union — safe here
  // because the prop sets above pin which field each type actually has.
  if (TITLE_PROP.has(shape.type)) {
    editor.updateShape({ id: shape.id, type: shape.type, props: { title }, meta } as TLShapePartial);
  } else if (NAME_PROP.has(shape.type)) {
    editor.updateShape({ id: shape.id, type: shape.type, props: { name: title }, meta } as TLShapePartial);
  } else {
    editor.updateShape({ id: shape.id, type: shape.type, meta: { ...meta, jzTitle: title } } as TLShapePartial);
  }
}

/**
 * An automatic title from the card's own words: the first non-empty line,
 * stripped of markdown markers, clipped at a word boundary. Used while the
 * user types into a text card whose title is empty or was itself derived —
 * a manual rename (jzTitleAuto=false with a non-empty title) always wins,
 * and so does a server-written title (set without the auto flag).
 */
export function deriveTitle(text: string): string {
  const line =
    text
      .split('\n')
      .map((l) => l.replace(/^[\s#>*+-]+/, '').replace(/^\[[ xX]\]\s*/, '').trim())
      .find(Boolean) ?? '';
  return line.length > 60 ? `${line.slice(0, 60).replace(/\s+\S*$/, '')}…` : line;
}

/** Should typing into this shape keep refreshing its auto-derived title? */
export function titleIsAuto(shape: TLShape): boolean {
  if (shape.meta?.jzTitleAuto === true) return true;
  return !getShapeTitle(shape).trim();
}
