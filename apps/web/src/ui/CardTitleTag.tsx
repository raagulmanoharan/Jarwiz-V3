/**
 * The primitive title tag — the shape's name, rendered OUTSIDE the frame just
 * above its top-left corner whenever it's the sole selection. Editable in
 * place; the same string is the ground chip in the composer (PromptBar) and
 * the grounding title sent with an ask. Overlay-rendered (not inside each
 * ShapeUtil) so every primitive gets it uniformly — text cards, tables,
 * stickies, PDFs, images, diagram groups — with zero per-shape code.
 */

import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { TITLED, getShapeTitle, setShapeTitle } from '../shapes/shapeTitle';

export function CardTitleTag() {
  const editor = useEditor();
  const target = useValue(
    'title-tag-target',
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const shape = editor.getShape(ids[0]!);
      if (!shape || !TITLED.has(shape.type)) return null;
      const b = editor.getShapePageBounds(shape.id);
      if (!b) return null;
      const p = editor.pageToViewport({ x: b.minX, y: b.minY });
      const w = b.w * editor.getZoomLevel();
      return { id: shape.id, title: getShapeTitle(shape), x: p.x, y: p.y, w };
    },
    [editor],
  );

  if (!target) return null;
  const shape = editor.getShape(target.id);
  if (!shape) return null;
  return (
    <input
      // Re-mount per shape so focus/caret never carries across selections.
      key={target.id}
      className="jz-title-tag"
      value={target.title}
      placeholder="Add a title"
      aria-label="Card title"
      style={{
        left: target.x + 2,
        top: target.y - 6,
        width: Math.max(140, Math.min(target.w - 4, 360)),
      }}
      onChange={(e) => setShapeTitle(editor, shape, e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
      onPointerDown={stopEventPropagation}
      onPointerMove={stopEventPropagation}
      onPointerUp={stopEventPropagation}
    />
  );
}
