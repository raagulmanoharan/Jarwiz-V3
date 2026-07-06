/**
 * Grow a card's height to fit its content — Miro's text-box behaviour: width is
 * fixed, height auto-adjusts. Two refinements layered on top:
 *  - while STREAMING, the card grows freely so you watch it being written;
 *  - once settled, content past `maxHeight` is CLAMPED (collapsed) unless the
 *    card is expanded, and we report `overflowing` so it can show an expand toggle.
 *
 * `growWidth` adds the page instinct: while the agent is writing, a card whose
 * content has outgrown a readable column WIDENS a step (and text reflows
 * shorter) before it resumes growing tall — long answers land page-shaped, not
 * skyscraper-shaped. Width growth only runs while streaming, so a width the
 * user set by hand is never fought over.
 *
 * Ratchet-free: the measured element lays out at height:auto, so its scrollHeight
 * is the true content height and doesn't depend on the shape height.
 */

import { useLayoutEffect, useState, type RefObject } from 'react';
import { useEditor, type TLShapeId } from 'tldraw';

interface GrowWidth {
  /** Widen no further than this. */
  max: number;
  /** Widen when content height exceeds `ratio × width` (default 1.4). */
  ratio?: number;
  /** Px added per widening step (default 120). */
  step?: number;
}

interface FitOpts {
  enabled?: boolean;
  streaming?: boolean;
  expanded?: boolean;
  maxHeight?: number;
  growWidth?: GrowWidth;
}

export function useFitHeight(
  shapeId: TLShapeId,
  ref: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
  { enabled = true, streaming = false, expanded = false, maxHeight = Infinity, growWidth }: FitOpts = {},
): boolean {
  const editor = useEditor();
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const measure = () => {
      if (editor.isIn('select.resizing')) return;
      const full = Math.ceil(el.scrollHeight);
      const cur = editor.getShape(shapeId);
      if (!cur) return;
      // Width first: if the streamed content has outgrown a readable column,
      // widen a step and let the ResizeObserver re-measure the reflowed height.
      if (streaming && growWidth) {
        const curW = (cur.props as { w?: number }).w ?? 0;
        const ratio = growWidth.ratio ?? 1.4;
        const step = growWidth.step ?? 120;
        if (curW > 0 && curW < growWidth.max && full > curW * ratio) {
          const w = Math.min(growWidth.max, curW + step);
          editor.updateShape({ id: shapeId, type: cur.type, props: { w } } as Parameters<
            typeof editor.updateShape
          >[0]);
          return;
        }
      }
      const over = full > maxHeight + 2;
      setOverflowing(over);
      const target = streaming || expanded || !over ? full : maxHeight;
      const curH = (cur.props as { h?: number }).h ?? 0;
      if (target > 0 && Math.abs(target - curH) > 1) {
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
  }, [editor, shapeId, enabled, streaming, expanded, maxHeight, growWidth?.max, ...deps]);

  return overflowing;
}
