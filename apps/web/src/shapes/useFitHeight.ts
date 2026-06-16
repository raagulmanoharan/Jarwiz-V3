/**
 * Grow a card's height to fit its content — Miro's text-box behaviour: width is
 * fixed, height auto-adjusts to show everything with no scroll. The observed
 * element must lay out at its natural (height:auto) height; we measure it and
 * push that back onto the shape so geometry/selection match what's rendered.
 *
 * Kept ratchet-free on purpose: the element is height:auto (NOT min-height:100%),
 * so its scrollHeight is the true content height and doesn't depend on the shape
 * height — measuring then can only converge, never spiral.
 */

import { useLayoutEffect, type RefObject } from 'react';
import { useEditor, type TLShapeId } from 'tldraw';

export function useFitHeight(
  shapeId: TLShapeId,
  ref: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
  enabled = true,
): void {
  const editor = useEditor();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const measure = () => {
      if (editor.isIn('select.resizing')) return; // don't fight an active resize
      const needed = Math.ceil(el.scrollHeight);
      const cur = editor.getShape(shapeId);
      const curH = cur ? (cur.props as { h?: number }).h ?? 0 : 0;
      if (cur && needed > 0 && Math.abs(needed - curH) > 1) {
        editor.updateShape({ id: shapeId, type: cur.type, props: { h: needed } } as Parameters<
          typeof editor.updateShape
        >[0]);
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, shapeId, enabled, ...deps]);
}
