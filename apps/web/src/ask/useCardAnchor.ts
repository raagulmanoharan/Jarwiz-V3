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
  opts: { dy?: number; margin?: number } = {},
): CardAnchor | null {
  const { dy = 12, margin = 90 } = opts;
  const editor = useEditor();
  const list = ids == null ? [] : Array.isArray(ids) ? ids : [ids];
  const key = list.join(',');
  return useValue(
    `jz card anchor ${key} ${dy} ${margin}`,
    () => {
      const boxes = list
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is Box => Boolean(b));
      if (boxes.length === 0) return null;
      const union = boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
      const p = editor.pageToViewport({ x: union.midX, y: union.maxY });
      const vp = editor.getViewportScreenBounds();
      return {
        x: Math.max(margin, Math.min(p.x, vp.w - margin)),
        y: Math.max(40, Math.min(p.y + dy, vp.h - 44)),
      };
    },
    // `key` makes the array dependency stable across renders.
    [editor, key, dy, margin],
  );
}
