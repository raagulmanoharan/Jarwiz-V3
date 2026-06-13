/**
 * Figma-style agent presence — colored avatar circles that glide to wherever
 * the agent is working. Coordinates are stored in page space (the `cursor`
 * AgentEvent target) and converted to viewport space here, reactively, so
 * they pan and zoom with the board. The CSS transition gives the unhurried
 * glide; circle size stays constant regardless of zoom.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { useEditor, useValue } from 'tldraw';
import { AGENTS, type AgentMeta } from '@jarwiz/shared';
import { getPresenceSnapshot, subscribePresence } from './presence';

const INITIALS: Record<string, string> = {
  researcher: 'R',
  summarizer: 'S',
  brainstormer: 'B',
  writer: 'W',
};

export function AgentCursorLayer() {
  const snapshot = useSyncExternalStore(subscribePresence, getPresenceSnapshot, getPresenceSnapshot);

  return (
    <>
      {AGENTS.map((agent) => {
        const presence = snapshot[agent.id];
        if (!presence?.active || !presence.cursor) return null;
        return (
          <AgentAvatar
            key={agent.id}
            agent={agent}
            page={presence.cursor}
            status={presence.status}
          />
        );
      })}
    </>
  );
}

function AgentAvatar({
  agent,
  page,
  status,
}: {
  agent: AgentMeta;
  page: { x: number; y: number };
  status: string | null;
}) {
  const editor = useEditor();

  const screen = useValue(
    'jarwiz agent avatar',
    () => editor.pageToViewport(page),
    [editor, page.x, page.y],
  );

  const initial = INITIALS[agent.id] ?? agent.name[0];

  return (
    <div
      className="jz-avatar"
      style={
        {
          // Center the 36px circle on the cursor point.
          transform: `translate(${screen.x - 18}px, ${screen.y - 18}px)`,
          '--agent-color': agent.color,
        } as CSSProperties
      }
    >
      <div className="jz-avatar-circle-wrap">
        <span className="jz-avatar-ring" aria-hidden />
        <div className="jz-avatar-circle" aria-label={agent.name}>
          <span className="jz-avatar-initial">{initial}</span>
        </div>
      </div>
      <div className="jz-avatar-badge">
        <span className="jz-avatar-name">{agent.name}</span>
        {status ? <span className="jz-avatar-status">{status}</span> : null}
      </div>
    </div>
  );
}
