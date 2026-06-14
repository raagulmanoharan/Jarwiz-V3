/**
 * Proactive suggestion pills — when an artifact (or a cluster of related
 * artifacts) lands, a cluster of agent-action pills floats above it, each in its
 * agent's color. One tap kicks off that agent on the card(s) (with the
 * suggestion's steering brief). Consent over magic: it only offers; the ✕
 * dismisses. Anchors to the combined bounds of the offered cards and follows
 * pan/zoom; clears itself if they're gone.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { Box, stopEventPropagation, useEditor, useValue, type TLShapeId } from 'tldraw';
import { getAgent } from '@jarwiz/shared';
import { dismissOffer, getOffer, subscribeOffer, type Suggestion } from './offers';

interface SuggestionPillsProps {
  /** Accept a suggestion — run its agent on the offered card(s). */
  onAccept: (shapeIds: TLShapeId[], suggestion: Suggestion) => void;
}

export function SuggestionPills({ onAccept }: SuggestionPillsProps) {
  const editor = useEditor();
  const offer = useSyncExternalStore(subscribeOffer, getOffer, getOffer);

  const anchor = useValue(
    'jarwiz offer anchor',
    () => {
      if (!offer) return null;
      const boxes = offer.shapeIds
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is Box => Boolean(b));
      if (boxes.length === 0) {
        queueMicrotask(() => dismissOffer(offer.shapeIds[0])); // all gone
        return null;
      }
      const union = boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
      const top = editor.pageToViewport({ x: union.midX, y: union.minY });
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
            onClick={() => onAccept(offer.shapeIds, s)}
          >
            <span className="jz-agent-dot" />
            {s.label}
          </button>
        );
      })}
      <button
        className="jz-offer-dismiss"
        aria-label="Dismiss suggestions"
        onClick={() => dismissOffer(offer.shapeIds[0])}
      >
        ✕
      </button>
    </div>
  );
}
