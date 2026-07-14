/**
 * The TL;DR strip — the one-glance gist that lives ON a dropped card (link,
 * video, PDF, spreadsheet), just below its preview. It shimmers a skeleton
 * while the summary generates, then swaps in a tight teaser; an idle or failed
 * card renders nothing (no empty strip, no lie). Presentational only — the
 * server call and the shape's height are owned by the cards that use it.
 *
 * Two height modes mirror the two card families:
 *  - `fit` (link card): natural height; the link card measures its whole body,
 *    so a short TL;DR makes a short strip, matching its content-fit ethos.
 *  - fixed (media cards): a reserved, clamped box, because a video/PDF/sheet
 *    viewer is sized to the card — the strip must claim a known slice of it.
 */

/** Reserved strip height for the media cards (video/PDF/sheet). The single
 *  source of truth: the height math in those cards and this box share it. */
export const TLDR_STRIP_H = 92;

import { useLayoutEffect, useRef } from 'react';
import { useEditor, type TLShape, type TLShapeId, type TLShapePartial } from 'tldraw';

export type TldrStatus = 'loading' | 'ready' | 'error';

/** Does this card currently want a strip (and thus reserve height for one)?
 *  Skeleton and ready both reserve, so there's no height jump when text lands. */
export function tldrPresent(status: TldrStatus | undefined, tldr: string | undefined): boolean {
  return status === 'loading' || (status === 'ready' && Boolean(tldr));
}

/**
 * Reserve (or release) the fixed strip height on a free-height media card
 * (video, spreadsheet) as the strip appears/vanishes. The viewer region is
 * sized to the card, so the strip must claim its own slice — grow the shape by
 * exactly TLDR_STRIP_H the moment it's present, shrink back when it's gone.
 * Additive-on-transition (not absolute), so it composes with a card's own
 * content-fit height. NOT for the PDF card, whose height is aspect-derived.
 */
export function useTldrReserve(shapeId: TLShapeId, type: TLShape['type'], present: boolean): void {
  const editor = useEditor();
  const appliedRef = useRef(false);
  useLayoutEffect(() => {
    if (present === appliedRef.current) return;
    const shape = editor.getShape(shapeId);
    if (!shape) return;
    appliedRef.current = present;
    const h = (shape.props as { h: number }).h + (present ? TLDR_STRIP_H : -TLDR_STRIP_H);
    // Cross-type patch (every card that uses this hook has `h`): the shared
    // partial can't discriminate, so cast to the union partial.
    editor.updateShape({ id: shapeId, type, props: { h } } as TLShapePartial);
  }, [editor, shapeId, type, present]);
}

interface TldrStripProps {
  tldr?: string;
  status?: TldrStatus;
  /** When set, the strip is a fixed-height reserved box (media cards). */
  fixedHeight?: number;
}

export function TldrStrip({ tldr, status, fixedHeight }: TldrStripProps) {
  if (!tldrPresent(status, tldr)) return null;
  const fixed = typeof fixedHeight === 'number';
  const style = fixed ? { height: fixedHeight } : undefined;

  return (
    <div className={`jz-tldr${fixed ? ' jz-tldr--fixed' : ''}`} style={style}>
      <span className="jz-tldr-label">TL;DR</span>
      {status === 'loading' ? (
        <div className="jz-tldr-lines" aria-label="Summarizing…">
          <div className="jz-skeleton" style={{ height: 9, width: '96%' }} />
          <div className="jz-skeleton" style={{ height: 9, width: '72%' }} />
        </div>
      ) : (
        <p className="jz-tldr-text jz-clamp-3">{tldr}</p>
      )}
    </div>
  );
}
