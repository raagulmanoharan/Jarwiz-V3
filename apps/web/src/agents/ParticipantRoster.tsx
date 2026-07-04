/**
 * The participant roster — a quiet face-pile of who's in the room: you, and
 * Jarwiz. The Jarwiz avatar breathes while it's working (presence store).
 * Clicking it asks Jarwiz on the current selection.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { Sparkle } from 'lucide-react';
import { JARWIZ } from '@jarwiz/shared';
import { getPresenceSnapshot, subscribePresence } from './presence';

export function ParticipantRoster({ onAsk }: { onAsk: () => void }) {
  const snapshot = useSyncExternalStore(subscribePresence, getPresenceSnapshot, getPresenceSnapshot);
  const active = Object.values(snapshot).some((p) => p?.active);

  return (
    <div className="jz-roster" role="group" aria-label="Who's in the room">
      <span className="jz-roster-you" title="You">
        You
      </span>
      <span className="jz-roster-divider" aria-hidden />
      <button
        className={`jz-roster-agent jz-roster-agent--jarwiz${active ? ' jz-roster-active' : ''}`}
        style={{ '--agent-color': JARWIZ.color } as CSSProperties}
        title={`${JARWIZ.name} — ${JARWIZ.tagline}`}
        aria-label={`Ask ${JARWIZ.name}`}
        onClick={onAsk}
      >
        <span className="jz-roster-avatar">
          <Sparkle size={14} strokeWidth={1.7} fill="currentColor" />
        </span>
      </button>
    </div>
  );
}
