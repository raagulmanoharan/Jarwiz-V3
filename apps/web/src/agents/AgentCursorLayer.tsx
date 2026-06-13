/**
 * Agent cursor overlay — named cursors in each agent's color that glide to
 * where the agent is working. Presence, made visible (VISION.md).
 *
 * Cursors are stored in page space (the `cursor` AgentEvent target) and
 * converted to viewport space here, reactively, so they pan and zoom with the
 * board. A CSS transition on the transform gives the unhurried "walk over"
 * glide; size stays constant regardless of zoom (FigJam-style).
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { useEditor, useValue } from 'tldraw';
import { AGENTS, type AgentMeta } from '@jarwiz/shared';
import { getPresenceSnapshot, subscribePresence } from './presence';

export function AgentCursorLayer() {
  const snapshot = useSyncExternalStore(subscribePresence, getPresenceSnapshot, getPresenceSnapshot);

  return (
    <>
      {AGENTS.map((agent) => {
        const presence = snapshot[agent.id];
        if (!presence?.active || !presence.cursor) return null;
        return (
          <AgentCursor
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

function AgentCursor({
  agent,
  page,
  status,
}: {
  agent: AgentMeta;
  page: { x: number; y: number };
  status: string | null;
}) {
  const editor = useEditor();

  // Reactive: recomputes on camera change (pan/zoom) and on new cursor target.
  const screen = useValue(
    'jarwiz agent cursor',
    () => editor.pageToViewport(page),
    [editor, page.x, page.y],
  );

  return (
    <div
      className="jz-cursor"
      style={
        {
          transform: `translate(${screen.x}px, ${screen.y}px)`,
          '--agent-color': agent.color,
        } as CSSProperties
      }
    >
      <svg className="jz-cursor-arrow" width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <path
          d="M3 2 L3 16 L7 12 L10 18 L12.5 17 L9.5 11 L15 11 Z"
          fill="var(--agent-color)"
          stroke="#fffefb"
          strokeWidth="1"
        />
      </svg>
      <div className="jz-cursor-label">
        {agent.name}
        {status ? <span className="jz-cursor-status">{status}</span> : null}
      </div>
    </div>
  );
}
