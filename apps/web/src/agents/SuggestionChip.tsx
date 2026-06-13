/**
 * The proactive offer — a small, dismissible chip the relevant agent raises
 * when context makes the next step obvious (a YouTube link or article lands).
 *
 * Consent over magic: the chip only *offers*. One tap accepts and starts a
 * normal run; the ✕ dismisses. It anchors to the card it's about and follows
 * it as the board pans/zooms. If the card is deleted, the offer clears itself.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { getAgent } from '@jarwiz/shared';
import type { TLShapeId } from 'tldraw';
import { dismissOffer, getOffer, subscribeOffer } from './offers';

interface SuggestionChipProps {
  /** Accept the offer — run the agent on the offered card. */
  onAccept: (shapeId: TLShapeId) => void;
}

export function SuggestionChip({ onAccept }: SuggestionChipProps) {
  const editor = useEditor();
  const offer = useSyncExternalStore(subscribeOffer, getOffer, getOffer);

  // Anchor above the top-center of the offered card; follows pan/zoom. Returns
  // null (and clears the offer) when the card no longer exists.
  const anchor = useValue(
    'jarwiz offer anchor',
    () => {
      if (!offer) return null;
      const bounds = editor.getShapePageBounds(offer.shapeId);
      if (!bounds) {
        // Card was deleted — drop the stale offer on the next tick.
        queueMicrotask(() => dismissOffer(offer.shapeId));
        return null;
      }
      const top = editor.pageToViewport({ x: bounds.midX, y: bounds.minY });
      return { x: top.x, y: top.y };
    },
    [editor, offer],
  );

  if (!offer || !anchor) return null;

  const agent = getAgent(offer.agentId);

  return (
    <div
      className="jz-offer"
      style={{ left: anchor.x, top: anchor.y - 14, '--agent-color': agent.color } as CSSProperties}
      onPointerDown={stopEventPropagation}
    >
      <button className="jz-offer-accept" onClick={() => onAccept(offer.shapeId)}>
        <span className="jz-agent-dot" />
        {offer.label}
      </button>
      <button
        className="jz-offer-dismiss"
        aria-label="Dismiss"
        onClick={() => dismissOffer(offer.shapeId)}
      >
        ✕
      </button>
    </div>
  );
}
