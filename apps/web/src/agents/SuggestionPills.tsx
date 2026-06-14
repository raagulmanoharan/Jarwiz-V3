/**
 * Proactive suggestion pills — when an artifact lands, a cluster of agent-action
 * pills floats above the card ("Summarize", "Find related", "Make a comparison
 * table"…), each in its agent's color. One tap kicks off that agent on the card
 * (with the suggestion's steering brief). Consent over magic: it only offers;
 * the ✕ dismisses the whole cluster. Anchors to the card and follows pan/zoom;
 * clears itself if the card is deleted.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue, type TLShapeId } from 'tldraw';
import { getAgent } from '@jarwiz/shared';
import { dismissOffer, getOffer, subscribeOffer, type Suggestion } from './offers';

interface SuggestionPillsProps {
  /** Accept a suggestion — run its agent on the offered card. */
  onAccept: (shapeId: TLShapeId, suggestion: Suggestion) => void;
}

export function SuggestionPills({ onAccept }: SuggestionPillsProps) {
  const editor = useEditor();
  const offer = useSyncExternalStore(subscribeOffer, getOffer, getOffer);

  const anchor = useValue(
    'jarwiz offer anchor',
    () => {
      if (!offer) return null;
      const bounds = editor.getShapePageBounds(offer.shapeId);
      if (!bounds) {
        queueMicrotask(() => dismissOffer(offer.shapeId)); // card deleted
        return null;
      }
      const top = editor.pageToViewport({ x: bounds.midX, y: bounds.minY });
      return { x: top.x, y: top.y };
    },
    [editor, offer],
  );

  if (!offer || !anchor) return null;

  return (
    <div
      className="jz-offer"
      style={{ left: anchor.x, top: anchor.y - 14 } as CSSProperties}
      onPointerDown={stopEventPropagation}
    >
      <span className="jz-offer-lead" aria-hidden>
        ✦
      </span>
      {offer.loading ? <span className="jz-offer-reading">reading…</span> : null}
      {offer.suggestions.map((s) => {
        const agent = getAgent(s.agentId);
        return (
          <button
            key={s.id}
            className="jz-offer-pill"
            style={{ '--agent-color': agent.color } as CSSProperties}
            title={`${agent.name}${s.brief ? ` — ${s.brief}` : ''}`}
            onClick={() => onAccept(offer.shapeId, s)}
          >
            <span className="jz-agent-dot" />
            {s.label}
          </button>
        );
      })}
      <button
        className="jz-offer-dismiss"
        aria-label="Dismiss suggestions"
        onClick={() => dismissOffer(offer.shapeId)}
      >
        ✕
      </button>
    </div>
  );
}
