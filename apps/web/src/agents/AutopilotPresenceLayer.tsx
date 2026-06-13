/**
 * Autopilot avatars — one Writer avatar per active fill, parked at that card
 * (or hopping cell to cell while a table fills). Because Autopilot runs are
 * concurrent background tasks, several can show at once: fire a continuation
 * here, start another there, and you'll see the Writer working in both places.
 *
 * Mirrors the Figma-style avatar of AgentCursorLayer, reusing its CSS.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { useEditor, useValue } from 'tldraw';
import {
  AUTOPILOT_AGENT,
  getAutopilotSnapshot,
  subscribeAutopilot,
  type AutopilotSession,
} from './autopilotStore';

export function AutopilotPresenceLayer() {
  const sessions = useSyncExternalStore(subscribeAutopilot, getAutopilotSnapshot, getAutopilotSnapshot);

  return (
    <>
      {[...sessions.values()].map((session) =>
        session.anchor ? <AutopilotAvatar key={session.cardId} session={session} /> : null,
      )}
    </>
  );
}

function AutopilotAvatar({ session }: { session: AutopilotSession }) {
  const editor = useEditor();
  const anchor = session.anchor!;

  const screen = useValue(
    'jarwiz autopilot avatar',
    () => editor.pageToViewport(anchor),
    [editor, anchor.x, anchor.y],
  );

  return (
    <div
      className="jz-avatar"
      style={
        {
          transform: `translate(${screen.x - 18}px, ${screen.y - 18}px)`,
          '--agent-color': AUTOPILOT_AGENT.color,
        } as CSSProperties
      }
    >
      <div className="jz-avatar-circle-wrap">
        <span className="jz-avatar-ring" aria-hidden />
        <div className="jz-avatar-circle" aria-label={AUTOPILOT_AGENT.name}>
          <span className="jz-avatar-initial">{AUTOPILOT_AGENT.name[0]}</span>
        </div>
      </div>
      <div className="jz-avatar-badge">
        <span className="jz-avatar-name">{AUTOPILOT_AGENT.name}</span>
        <span className="jz-avatar-status">{session.status}</span>
      </div>
    </div>
  );
}
