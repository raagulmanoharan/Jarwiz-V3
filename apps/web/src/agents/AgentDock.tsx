import { useSyncExternalStore, type CSSProperties } from 'react';
import { AGENTS } from '@jarwiz/shared';
import { getPresenceSnapshot, subscribePresence } from './presence';

/**
 * The dock — a calm strip showing who's on the board and what each agent is
 * doing right now. Statuses are driven live by the presence store: idle by
 * default, the honest status text while a run is in flight.
 */
export function AgentDock() {
  const snapshot = useSyncExternalStore(subscribePresence, getPresenceSnapshot, getPresenceSnapshot);

  return (
    <div className="jz-dock" data-testid="agent-dock">
      {AGENTS.map((agent) => {
        const presence = snapshot[agent.id];
        const active = presence?.active ?? false;
        return (
          <div
            key={agent.id}
            className={`jz-dock-agent${active ? ' jz-dock-agent-active' : ''}`}
            title={agent.tagline}
            style={{ '--agent-color': agent.color } as CSSProperties}
          >
            <div className="jz-dock-top">
              <span className={`jz-agent-dot${active ? ' jz-agent-dot-pulse' : ''}`} />
              <span className="jz-dock-name">{agent.name}</span>
            </div>
            <span className="jz-dock-status">
              {active ? (presence?.status ?? 'working…') : 'idle'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
