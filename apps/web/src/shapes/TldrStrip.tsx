/**
 * The TL;DR strip — the one-glance gist that lives ON a dropped card (link,
 * video, PDF, spreadsheet), just below its preview. It shimmers a skeleton
 * while the summary generates, then swaps in the gist; an idle or failed card
 * renders nothing (no empty strip, no lie). The card's own look is untouched —
 * this only appends a section below it. Presentational only; the server call
 * and the shape's height are owned by the cards that use it.
 *
 * It grows to fit — a TL;DR is short, so we show all of it, never truncated.
 * The link card is already content-height and folds the strip into its own
 * measure. The media cards' viewers are sized to the card, so they measure the
 * strip (useTldrGrowth) and grow the shape by exactly its height.
 */

import { forwardRef, useLayoutEffect, useRef, useState } from 'react';
import { useEditor, type TLShape, type TLShapeId, type TLShapePartial } from 'tldraw';

export type TldrStatus = 'loading' | 'ready' | 'error';

/** Does this card currently want a strip? Skeleton and ready both do; idle and
 *  error don't. */
export function tldrPresent(status: TldrStatus | undefined, tldr: string | undefined): boolean {
  return status === 'loading' || (status === 'ready' && Boolean(tldr));
}

/**
 * Grow a free-height media card (video, spreadsheet) to fit its strip. Measures
 * the strip element and keeps the shape exactly that much taller — additive on
 * the measured delta, so it composes with the card's own content height and a
 * strip that grows when its text lands (or shrinks to nothing on error).
 * Returns the measured strip height for cards that fold it into their own math.
 * NOT for the PDF card, whose height is aspect-derived (it measures directly).
 */
export function useTldrGrowth(
  shapeId: TLShapeId,
  type: TLShape['type'],
  ref: React.RefObject<HTMLElement | null>,
  signature: string,
): number {
  const editor = useEditor();
  const [measured, setMeasured] = useState(0);
  const applied = useRef(0);
  useLayoutEffect(() => {
    const want = ref.current ? Math.ceil(ref.current.offsetHeight) : 0;
    if (want !== measured) setMeasured(want);
    if (Math.abs(want - applied.current) > 1) {
      const delta = want - applied.current;
      applied.current = want;
      const shape = editor.getShape(shapeId);
      if (shape) {
        const h = (shape.props as { h: number }).h + delta;
        editor.updateShape({ id: shapeId, type, props: { h } } as TLShapePartial);
      }
    }
  }, [editor, shapeId, type, signature, measured, ref]);
  return measured;
}

interface TldrStripProps {
  tldr?: string;
  status?: TldrStatus;
}

/** The strip root is forwardRef'd so media cards can measure it directly. */
export const TldrStrip = forwardRef<HTMLDivElement, TldrStripProps>(function TldrStrip(
  { tldr, status },
  ref,
) {
  if (!tldrPresent(status, tldr)) return null;
  return (
    <div className="jz-tldr" ref={ref}>
      <span className="jz-tldr-label">TL;DR</span>
      {status === 'loading' ? (
        <div className="jz-tldr-lines" aria-label="Summarizing…">
          <div className="jz-skeleton" style={{ height: 9, width: '96%' }} />
          <div className="jz-skeleton" style={{ height: 9, width: '72%' }} />
        </div>
      ) : (
        <p className="jz-tldr-text">{tldr}</p>
      )}
    </div>
  );
});
