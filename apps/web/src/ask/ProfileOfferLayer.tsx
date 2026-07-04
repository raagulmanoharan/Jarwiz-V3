/**
 * The drop-moment profile chip — "✦ Profile this document" floating under a
 * just-dropped PDF (docs/PDF-EDGE.md build 3). Offered, never forced: ✕
 * dismisses it for that document, deleting the card clears it, and accepting
 * hands the profile prompt to the ordinary Ask pipeline (streamed doc card,
 * provenance edge, Keep/Discard).
 */

import { useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { dismissProfileOffer, getProfileOffer, subscribeProfileOffer, PROFILE_PROMPT } from './profileOffer';
import { useCardAnchor } from './useCardAnchor';
import { useAsk } from './useAsk';

export function ProfileOfferLayer() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const offer = useSyncExternalStore(subscribeProfileOffer, getProfileOffer, getProfileOffer);

  // Housekeeping: the card was deleted (or undone) out from under the offer.
  // Don't remember the asset — re-dropping the same file should offer again.
  const cardGone = useValue(
    'profile-offer-card',
    () => Boolean(offer && !editor.getShape(offer.cardId)),
    [editor, offer],
  );
  useEffect(() => {
    if (offer && cardGone) dismissProfileOffer(false);
  }, [offer, cardGone]);

  const anchor = useCardAnchor(offer && !cardGone ? offer.cardId : null, { dy: 14 });
  if (!offer || cardGone || !anchor || isAsking) return null;

  const run = () => {
    const { cardId } = offer;
    dismissProfileOffer(); // remember before the ask so a retry never re-offers
    void ask(PROFILE_PROMPT, [cardId], { skipClarify: true });
  };

  const style: CSSProperties = { left: anchor.x, top: anchor.y, transform: 'translateX(-50%)' };
  return (
    <div className="jz-profile-offer" style={style} onPointerDown={stopEventPropagation}>
      <button className="jz-profile-offer-main" onClick={run} title="A one-glance profile: what this is, who wrote it, red flags, where to start">
        <span className="jz-ask-spark" aria-hidden>✦</span>
        Profile this document
      </button>
      <button className="jz-profile-offer-x" aria-label="No thanks" title="No thanks" onClick={() => dismissProfileOffer()}>
        ✕
      </button>
    </div>
  );
}
