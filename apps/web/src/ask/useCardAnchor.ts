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
  /** Top-edge affordances only: where the bar actually landed. 'above' the
   *  card (normal), flipped 'below' it (no headroom — e.g. the user is
   *  scrolled into a tall card), or 'over' it (neither edge on-screen). */
  placement: 'above' | 'below' | 'over';
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
      const x = Math.max(margin, Math.min(p.x, vp.w - margin));
      if (edge === 'top') {
        // The card action bar renders ABOVE its anchor (translateY(-100%)).
        // Floor 44: the topbar's clusters sit in the corners, so the centre
        // strip is clear for the ~40px bar. When the card's top edge leaves
        // no headroom (the user is scrolled INTO a tall card), the bar FLIPS
        // below the card's bottom edge instead of squatting on the content;
        // only when neither edge is on-screen does it sit over the card.
        const FLOOR = 44;
        const wanted = p.y + dy;
        if (wanted >= FLOOR) {
          return { x, y: Math.min(wanted, vp.h - 60), placement: 'above' as const };
        }
        const below = editor.pageToViewport({ x: union.midX, y: union.maxY }).y + 12;
        if (below < vp.h - 240) {
          // Clear of the prompt-bar dock (bar renders DOWNWARD from here).
          return { x, y: below, placement: 'below' as const };
        }
        return { x, y: FLOOR, placement: 'over' as const };
      }
      // Bottom-edge affordances keep clear of the prompt-bar dock plus their
      // own downward pill stack.
      return {
        x,
        y: Math.max(40, Math.min(p.y + dy, vp.h - 230)),
        placement: 'below' as const,
      };
    },
    // `key` makes the array dependency stable across renders.
    [editor, key, dy, margin, edge],
  );
}
