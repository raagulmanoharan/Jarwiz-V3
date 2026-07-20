/**
 * Cards don't overlap. When a card is moved, any cards it lands on slide out of
 * the way — a light collision constraint (not a full simulation): the card you
 * drag stays put (it's your intent), everything it overlaps is pushed apart
 * along the shallower axis, cascading, until nothing overlaps. Runs live off
 * store changes (user source) so it feels physical while dragging.
 *
 * Mounted once inside the canvas (App JarwizOverlay). Renders nothing.
 */

import { useEffect } from 'react';
import { useEditor, type Editor, type TLShapeId } from 'tldraw';

const GAP = 12; // minimum breathing room between two cards, in page units
const MAX_ITERS = 16; // cascade depth cap — a hard stop against pathological loops
const isCard = (type: string) => type.endsWith('-card');

/** Separate every overlapping pair of cards, holding the SELECTED cards (the
 *  ones being dragged) fixed. Resolves in page space, then applies the delta to
 *  each shape's own x/y so it works for framed children too. Idempotent once
 *  nothing overlaps, so re-entrant store events converge to a no-op. */
function resolveOverlaps(editor: Editor): void {
  const cards = editor.getCurrentPageShapes().filter((s) => isCard(s.type));
  if (cards.length < 2) return;
  const anchors = new Set<TLShapeId>(editor.getSelectedShapeIds());

  const boxes = cards
    .map((c) => {
      const b = editor.getShapePageBounds(c.id);
      return b ? { id: c.id, x: b.x, y: b.y, w: b.w, h: b.h, ox: b.x, oy: b.y } : null;
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let any = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i]!;
        const B = boxes[j]!;
        const penX = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) + GAP;
        const penY = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) + GAP;
        if (penX <= 0 || penY <= 0) continue; // no overlap (with gap)
        const aFixed = anchors.has(A.id);
        const bFixed = anchors.has(B.id);
        if (aFixed && bFixed) continue; // both held — can't separate these two
        any = true;
        if (penX < penY) {
          const d = penX * (A.x + A.w / 2 <= B.x + B.w / 2 ? 1 : -1);
          if (aFixed) B.x += d;
          else if (bFixed) A.x -= d;
          else { A.x -= d / 2; B.x += d / 2; }
        } else {
          const d = penY * (A.y + A.h / 2 <= B.y + B.h / 2 ? 1 : -1);
          if (aFixed) B.y += d;
          else if (bFixed) A.y -= d;
          else { A.y -= d / 2; B.y += d / 2; }
        }
      }
    }
    if (!any) break;
  }

  const updates = boxes
    .filter((b) => Math.abs(b.x - b.ox) > 0.5 || Math.abs(b.y - b.oy) > 0.5)
    .map((b) => {
      const s = editor.getShape(b.id)!;
      return { id: b.id, type: s.type, x: s.x + (b.x - b.ox), y: s.y + (b.y - b.oy) };
    });
  if (updates.length === 0) return;
  // history:'ignore' — the nudges ride along with the drag, they aren't their
  // own undo steps.
  editor.run(() => editor.updateShapes(updates as Parameters<typeof editor.updateShapes>[0]), { history: 'ignore' });
}

export function CardPhysics() {
  const editor = useEditor();
  useEffect(() => {
    let raf = 0;
    let resolving = false;
    const kick = () => {
      if (resolving || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        resolving = true;
        try {
          resolveOverlaps(editor);
        } finally {
          resolving = false;
        }
      });
    };
    const unlisten = editor.store.listen(
      (entry) => {
        if (resolving) return;
        const updated = entry.changes.updated as Record<string, [{ typeName?: string; type?: string; x?: number; y?: number }, { typeName?: string; type?: string; x?: number; y?: number }]>;
        for (const key in updated) {
          const [from, to] = updated[key]!;
          if (to?.typeName === 'shape' && to.type && isCard(to.type) && (from.x !== to.x || from.y !== to.y)) {
            kick();
            return;
          }
        }
      },
      { scope: 'document', source: 'user' },
    );
    return () => {
      unlisten();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [editor]);
  return null;
}
