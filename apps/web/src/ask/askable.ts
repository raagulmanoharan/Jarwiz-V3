/**
 * Which shape types can ground an Ask. Rich cards plus native primitives
 * (canvas pivot P1): a selected shape, label, or hand-drawn cluster is
 * askable, so "create something from this" works on a sketch, not just cards.
 * Shared by the prompt bar (ground chips) and the card action bar.
 */
import { renderPlaintextFromRichText, type Editor, type TLRichText, type TLShape } from 'tldraw';

export const ASKABLE = new Set([
  'pdf-card', 'doc-card', 'table-card', 'diagram-card', 'note-card', 'image-card', 'link-card',
  'geo', 'text', 'note', 'arrow', 'frame', 'group',
]);

/**
 * Does this shape actually contain something to ask about? Being the right
 * TYPE isn't enough — an empty doc card has nothing to summarise, and a PDF
 * mid-upload isn't readable yet. Starter chips and Refine transforms
 * all gate on this, so the UI never offers questions about nothing.
 */
export function hasAskableContent(editor: Editor, shape: TLShape | undefined): boolean {
  if (!shape) return false;
  const p = shape.props as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  switch (shape.type) {
    case 'doc-card':
      // Text only — a title alone is a NAME, not content (the grounding path
      // in useAsk.toSource applies the same rule).
      return Boolean(str(p.text));
    case 'note-card':
      return Boolean(str(p.text));
    case 'diagram-card':
      return Boolean(str(p.code));
    case 'table-card': {
      const rows = Array.isArray(p.rows) ? (p.rows as unknown[][]) : [];
      return rows.some((r) => Array.isArray(r) && r.some((c) => str(c)));
    }
    case 'pdf-card':
      return p.status === 'ready'; // uploading/error → nothing readable yet
    case 'image-card':
      return Boolean(str(p.src));
    case 'link-card':
      return Boolean(str(p.url));
    case 'frame':
    case 'group':
      // A frame's or group's meaning is its children — contentful if any is.
      // (Generated flowcharts arrive as groups: click the group, ask about
      // the whole diagram; double-click to edit the shapes inside.)
      return editor
        .getSortedChildIdsForParent(shape.id)
        .some((cid) => hasAskableContent(editor, editor.getShape(cid)));
    default: {
      // Native primitives (geo/text/note/arrow): their text label is the content.
      if (p.richText) {
        try {
          return Boolean(renderPlaintextFromRichText(editor, p.richText as TLRichText).trim());
        } catch {
          return false;
        }
      }
      return Boolean(str(p.text));
    }
  }
}
