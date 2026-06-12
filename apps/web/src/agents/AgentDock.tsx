import type { CSSProperties } from 'react';
import { AGENTS } from '@jarwiz/shared';

/**
 * The dock — a calm strip showing who's on the board and what each agent is
 * doing. In M0 every agent is idle; the M1 runtime will drive these statuses
 * from AgentEvent streams.
 */
export function AgentDock() {
  return (
    <div className="jz-dock" data-testid="agent-dock">
      {AGENTS.map((agent) => (
        <div
          key={agent.id}
          className="jz-dock-agent"
          title={agent.tagline}
          style={{ '--agent-color': agent.color } as CSSProperties}
        >
          <div className="jz-dock-top">
            <span className="jz-agent-dot" />
            <span className="jz-dock-name">{agent.name}</span>
          </div>
          <span className="jz-dock-status">idle</span>
        </div>
      ))}
    </div>
  );
}
