/**
 * Grow a card's height to fit its content — Miro's text-box behaviour: width is
 * fixed, height auto-adjusts. Two refinements layered on top:
 *  - while STREAMING, the card grows freely so you watch it being written;
 *  - once settled, content past `maxHeight` is CLAMPED (collapsed) unless the
 *    card is expanded, and we report `overflowing` so it can show an expand toggle.
 *
 * Ratchet-free: the measured element lays out at height:auto, so its scrollHeight
 * is the true content height and doesn't depend on the shape height.
 */

import { useLayoutEffect, useState, type RefObject } from 'react';
import { useEditor, type TLShapeId } from 'tldraw';

interface FitOpts {
  enabled?: boolean;
  streaming?: boolean;
  expanded?: boolean;
  maxHeight?: number;
}

export function useFitHeight(
  shapeId: TLShapeId,
  ref: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
  { enabled = true, streaming = false, expanded = false, maxHeight = Infinity }: FitOpts = {},
): boolean {
  const editor = useEditor();
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const measure = () => {
      if (editor.isIn('select.resizing')) return; // don't fight an active resize
      const full = Math.ceil(el.scrollHeight);
      const over = full > maxHeight + 2;
      setOverflowing(over);
      const target = streaming || expanded || !over ? full : maxHeight;
      const cur = editor.getShape(shapeId);
      const curH = cur ? (cur.props as { h?: number }).h ?? 0 : 0;
      if (cur && target > 0 && Math.abs(target - curH) > 1) {
        editor.updateShape({ id: shapeId, type: cur.type, props: { h: target } } as Parameters<
          typeof editor.updateShape
        >[0]);
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, shapeId, enabled, streaming, expanded, maxHeight, ...deps]);

  return overflowing;
}
