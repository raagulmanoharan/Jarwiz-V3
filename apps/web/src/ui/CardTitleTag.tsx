/**
 * The primitive title tags — every titled card's name, rendered OUTSIDE the
 * frame just above its top-left corner. Labels are ALWAYS visible (owner call
 * 2026-07-05): the board reads like a map of named artifacts, not a mystery
 * of identical frames. The sole-selected shape's tag becomes an input for
 * in-place renaming; every tag is also a HANDLE — dragging the title drags
 * the card (owner call 2026-07-10), a plain click selects (or, when already
 * selected, starts a rename). Overlay-rendered (not inside each ShapeUtil) so
 * every primitive gets it uniformly with zero per-shape code.
 */

import { useRef } from 'react';
import { useEditor, useValue, type TLShapeId, type TLShapePartial } from 'tldraw';
import { TITLED, getShapeTitle, setShapeTitle, titleIsInlineHeading } from '../shapes/shapeTitle';

interface Tag {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  editable: boolean;
}

/** A drag-in-progress from a title tag. `moved` flips once the pointer clears
 *  the click slop — before that, pointer-up is a click (select / rename). */
interface TitleDrag {
  id: TLShapeId;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

/** Screen-px of movement that separates a click from a drag. */
const DRAG_SLOP = 4;

export function CardTitleTag() {
  const editor = useEditor();
  const drag = useRef<TitleDrag | null>(null);
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
        // A generated card whose title is just its inline heading needs no tag
        // in the resting state — the heading already shows inside it. Selecting
        // it still surfaces the tag (a rename affordance) via `editable`.
        if (titleIsInlineHeading(shape) && !editable) continue;
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

  // The tag doubles as a drag handle for its card. preventDefault on the down
  // keeps the input from grabbing focus/starting a text selection mid-drag; a
  // clean click focuses it on the UP instead. When the input is ALREADY
  // focused the user is renaming — native caret/selection behaviour wins.
  const onTagPointerDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (document.activeElement === e.currentTarget) return;
    e.preventDefault();
    const shape = editor.getShape(id as TLShapeId);
    if (!shape) return;
    drag.current = { id: id as TLShapeId, startX: e.clientX, startY: e.clientY, originX: shape.x, originY: shape.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onTagPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      d.moved = true;
      editor.markHistoryStoppingPoint('drag card by title');
    }
    const shape = editor.getShape(d.id);
    if (!shape) return;
    // Screen delta → page delta; frames don't scale, so parent space matches.
    const z = editor.getZoomLevel();
    editor.updateShape({ id: d.id, type: shape.type, x: d.originX + dx / z, y: d.originY + dy / z } as TLShapePartial);
  };
  const onTagPointerUp = (e: React.PointerEvent<HTMLElement>, editable: boolean) => {
    e.stopPropagation();
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved || !editable) {
      // A drag lands like a body-drag would — the moved card ends selected.
      // A plain click on an unselected card's label selects it too.
      editor.select(d.id);
    } else {
      // Plain click on the selected card's tag → rename in place.
      const el = e.currentTarget as HTMLInputElement;
      el.focus?.();
      el.setSelectionRange?.(el.value.length, el.value.length);
    }
  };
  const onTagPointerCancel = () => {
    drag.current = null;
  };

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
          // Label as handle: click selects the card, drag moves it.
          return (
            <div
              key={t.id}
              className="jz-title-tag jz-title-tag--label"
              style={style}
              onPointerDown={(e) => onTagPointerDown(e, t.id)}
              onPointerMove={onTagPointerMove}
              onPointerUp={(e) => onTagPointerUp(e, false)}
              onPointerCancel={onTagPointerCancel}
            >
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
            onPointerDown={(e) => onTagPointerDown(e, t.id)}
            onPointerMove={onTagPointerMove}
            onPointerUp={(e) => onTagPointerUp(e, true)}
            onPointerCancel={onTagPointerCancel}
          />
        );
      })}
    </>
  );
}
