/**
 * The primitive title tags — every titled card's name, rendered OUTSIDE the
 * frame just above its top-left corner. Labels are ALWAYS visible (owner call
 * 2026-07-05): the board reads like a map of named artifacts, not a mystery
 * of identical frames. The sole-selected shape's tag becomes an input for
 * in-place renaming; unselected tags are inert text that lets clicks fall
 * through to the shape. Overlay-rendered (not inside each ShapeUtil) so every
 * primitive gets it uniformly with zero per-shape code.
 */

import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { TITLED, getShapeTitle, setShapeTitle } from '../shapes/shapeTitle';

interface Tag {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  editable: boolean;
}

export function CardTitleTag() {
  const editor = useEditor();
  const tags = useValue(
    'title-tags',
    () => {
      const selected = editor.getOnlySelectedShapeId();
      const vp = editor.getViewportScreenBounds();
      const out: Tag[] = [];
      for (const shape of editor.getCurrentPageShapes()) {
        if (!TITLED.has(shape.type)) continue;
        const editable = shape.id === selected;
        const title = getShapeTitle(shape);
        // Untitled cards stay quiet — the "Add a title" affordance appears
        // only on selection, so the canvas never fills with placeholders.
        if (!title.trim() && !editable) continue;
        const b = editor.getShapePageBounds(shape.id);
        if (!b) continue;
        const p = editor.pageToViewport({ x: b.minX, y: b.minY });
        if (p.x > vp.w || p.y > vp.h || p.y < 0 || p.x < -b.w * editor.getZoomLevel()) continue;
        out.push({ id: shape.id, title, x: p.x, y: p.y, w: b.w * editor.getZoomLevel(), editable });
      }
      return out;
    },
    [editor],
  );

  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((t) => {
        const style = {
          left: t.x + 2,
          top: t.y - 6,
          width: Math.max(140, Math.min(t.w - 4, 360)),
        };
        if (!t.editable) {
          // Inert label: clicks pass through and select the shape beneath.
          return (
            <div key={t.id} className="jz-title-tag jz-title-tag--label" style={style}>
              {t.title}
            </div>
          );
        }
        const shape = editor.getShape(t.id as Parameters<typeof editor.getShape>[0]);
        if (!shape) return null;
        return (
          <input
            // Re-mount per shape so focus/caret never carries across selections.
            key={t.id}
            className="jz-title-tag"
            value={t.title}
            placeholder="Add a title"
            aria-label="Card title"
            style={style}
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
      })}
    </>
  );
}
