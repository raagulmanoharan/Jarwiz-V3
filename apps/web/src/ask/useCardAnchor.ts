/**
 * Where a floating affordance should sit relative to the card(s) it belongs to.
 * Every on-canvas affordance (the Ask pill, the draft controls, the in-place
 * regeneration progress, the clarifying question) needs the same maths: take
 * the union of some shapes' page bounds, drop to their bottom-centre, convert to
 * viewport pixels, and clamp on-screen. This hook is that maths in one place, so
 * the affordances stop each re-deriving it (and drifting apart).
 */

import { useEditor, useValue, type Box, type TLShapeId } from 'tldraw';

export interface CardAnchor {
  x: number;
  y: number;
}

export function useCardAnchor(
  ids: TLShapeId | TLShapeId[] | null | undefined,
  opts: { dy?: number; margin?: number; edge?: 'top' | 'bottom' } = {},
): CardAnchor | null {
  const { dy = 12, margin = 90, edge = 'bottom' } = opts;
  const editor = useEditor();
  const list = ids == null ? [] : Array.isArray(ids) ? ids : [ids];
  const key = list.join(',');
  return useValue(
    `jz card anchor ${key} ${dy} ${margin} ${edge}`,
    () => {
      const boxes = list
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is Box => Boolean(b));
      if (boxes.length === 0) return null;
      const union = boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
      const p = editor.pageToViewport({
        x: union.midX,
        y: edge === 'top' ? union.minY : union.maxY,
      });
      const vp = editor.getViewportScreenBounds();
      // Clamp on-screen. Bottom-edge affordances keep clear of the prompt-bar
      // dock plus their own downward pill stack. Top-edge ones (the card
      // action bar) render ABOVE their anchor (translateY(-100%)), so the
      // floor is the bar's BOTTOM: 62 keeps the ~36px bar under the browser
      // edge while staying above the card as long as possible — the topbar's
      // clusters sit in the corners, so the centre strip it floats in is
      // clear. (The old floor of 118 shoved the bar INSIDE tall cards.)
      return {
        x: Math.max(margin, Math.min(p.x, vp.w - margin)),
        y:
          edge === 'top'
            ? Math.max(62, Math.min(p.y + dy, vp.h - 60))
            : Math.max(40, Math.min(p.y + dy, vp.h - 230)),
      };
    },
    // `key` makes the array dependency stable across renders.
    [editor, key, dy, margin, edge],
  );
}
