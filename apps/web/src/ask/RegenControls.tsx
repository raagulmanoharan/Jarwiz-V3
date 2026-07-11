/**
 * Floating control for an in-place regeneration. While a selected answer card
 * is being rewritten (a same-type tweak), this shows "Regenerating…" with a
 * Cancel just under the card — the progress + escape hatch a streaming draft
 * gets, for the draftless in-place path. Cancel aborts the model call and
 * restores the card's previous content; otherwise the new version simply lands.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation } from 'tldraw';
import { getRegen, subscribeRegen } from './regen';
import { useCardAnchor } from './useCardAnchor';
import { cancelActiveAsk } from './useAsk';
import { JarwizSpark } from '../ui/JarwizSpark';

export function RegenControls() {
  const regen = useSyncExternalStore(subscribeRegen, getRegen, getRegen);
  const anchor = useCardAnchor(regen?.id ?? null);

  if (!regen || !anchor) return null;
  const style = { left: anchor.x, top: anchor.y } as CSSProperties;

  return (
    <div className="jz-draft" style={style} onPointerDown={stopEventPropagation}>
      <span className="jz-draft-spark" aria-hidden>
        <JarwizSpark size={12} />
      </span>
      <span className="jz-draft-label">Regenerating…</span>
      <button className="jz-draft-discard" onClick={() => cancelActiveAsk()}>
        Cancel
      </button>
    </div>
  );
}
