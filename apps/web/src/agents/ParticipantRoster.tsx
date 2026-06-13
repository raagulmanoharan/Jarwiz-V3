/**
 * The participant roster — a quiet face-pile of who's in the room: you, and the
 * agents. An agent's avatar breathes while it's working (presence store). It
 * makes the agents feel like members, not features; clicking one calls it on
 * the current selection (another way to address a teammate, alongside @mention
 * and ⌘K).
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { AGENTS, type AgentMeta } from '@jarwiz/shared';
import { getPresenceSnapshot, subscribePresence } from './presence';

export function ParticipantRoster({ onPick }: { onPick: (agent: AgentMeta) => void }) {
  const snapshot = useSyncExternalStore(subscribePresence, getPresenceSnapshot, getPresenceSnapshot);

  return (
    <div className="jz-roster" role="group" aria-label="Who's in the room">
      <span className="jz-roster-you" title="You">
        You
      </span>
      <span className="jz-roster-divider" aria-hidden />
      {AGENTS.map((agent) => {
        const active = snapshot[agent.id]?.active ?? false;
        return (
          <button
            key={agent.id}
            className={`jz-roster-agent${active ? ' jz-roster-active' : ''}`}
            style={{ '--agent-color': agent.color } as CSSProperties}
            title={`${agent.name} — ${agent.tagline}`}
            aria-label={`Ask ${agent.name}`}
            onClick={() => onPick(agent)}
          >
            <span className="jz-roster-avatar">{agent.name[0]}</span>
          </button>
        );
      })}
    </div>
  );
}
