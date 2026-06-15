/**
 * Proactive suggestion pills — every live offer renders its own cluster of
 * agent-action pills next to the card(s) it's about. A dropped artifact gets
 * its own pills; a detected cluster gets cross-cutting pills — and they coexist
 * (a card carries its own pills plus the cluster's). One tap kicks off that
 * agent on the card(s); ✕ dismisses that offer. Anchors follow pan/zoom and
 * self-clear when the cards are gone.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { Box, stopEventPropagation, useEditor, useValue } from 'tldraw';
import { getAgent } from '@jarwiz/shared';
import { dissolveCluster } from './cluster';
import { dismissOffer, getOffers, subscribeOffer, type Offer, type Suggestion } from './offers';

interface SuggestionPillsProps {
  onAccept: (offer: Offer, suggestion: Suggestion) => void;
}

export function SuggestionPills({ onAccept }: SuggestionPillsProps) {
  const offers = useSyncExternalStore(subscribeOffer, getOffers, getOffers);
  return (
    <>
      {offers.map((offer) => (
        <OfferPills key={offer.id} offer={offer} onAccept={onAccept} />
      ))}
    </>
  );
}

function OfferPills({ offer, onAccept }: { offer: Offer; onAccept: SuggestionPillsProps['onAccept'] }) {
  const editor = useEditor();

  const anchor = useValue(
    `jarwiz offer anchor ${offer.id}`,
    () => {
      const boxes = offer.shapeIds
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is Box => Boolean(b));
      if (boxes.length === 0) {
        queueMicrotask(() => dismissOffer(offer.id)); // all cards gone
        return null;
      }
      const union = boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
      const top = editor.pageToViewport({ x: union.midX, y: union.minY });
      // Cluster pills sit higher so they don't overlap the per-artifact pills.
      return { x: top.x, y: top.y - (offer.kind === 'cluster' ? 56 : 14) };
    },
    [editor, offer],
  );

  if (!anchor) return null;
  const isCluster = offer.kind === 'cluster';

  return (
    <div
      className={`jz-offer${isCluster ? ' jz-offer-cluster' : ''}`}
      style={{ left: anchor.x, top: anchor.y } as CSSProperties}
      onPointerDown={stopEventPropagation}
    >
      <span className="jz-offer-lead" aria-hidden>
        {isCluster ? '⌘' : '✦'}
      </span>
      {isCluster ? (
        <span className="jz-offer-clusterlabel">Across {offer.shapeIds.length}</span>
      ) : null}
      {offer.loading ? <span className="jz-offer-reading">reading…</span> : null}
      {offer.suggestions.map((s) => {
        const agent = getAgent(s.agentId);
        return (
          <button
            key={s.id}
            className="jz-offer-pill"
            style={{ '--agent-color': agent.color } as CSSProperties}
            title={`${agent.name}${s.brief ? ` — ${s.brief}` : ''}`}
            onClick={() => onAccept(offer, s)}
          >
            <span className="jz-agent-dot" />
            {s.label}
          </button>
        );
      })}
      <button
        className="jz-offer-dismiss"
        aria-label="Dismiss suggestions"
        onClick={() => {
          dismissOffer(offer.id);
          if (offer.kind === 'cluster') dissolveCluster(offer.id);
        }}
      >
        ✕
      </button>
    </div>
  );
}
