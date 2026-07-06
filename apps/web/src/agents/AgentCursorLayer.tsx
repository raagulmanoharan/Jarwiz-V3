/**
 * Jarwiz presence — one avatar, one identity. Internally Jarwiz is a
 * multi-agent system, but the user sees a single collaborator: a white circle
 * with the Sparkle mark, gliding to wherever Jarwiz is working. Coordinates
 * are page-space (the `cursor` AgentEvent target) and converted to viewport
 * space reactively, so the avatar pans and zooms with the board.
 *
 * If multiple internal specialists are active at once (rare — agent runs are
 * one-at-a-time in useAgentRun), we collapse to a single Jarwiz cursor by
 * showing whichever is active, with the latest status text.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { useEditor, useValue } from 'tldraw';
import { Sparkle } from 'lucide-react';
import { JARWIZ } from '@jarwiz/shared';
import { getPresenceSnapshot, subscribePresence } from './presence';

export function AgentCursorLayer() {
  const snapshot = useSyncExternalStore(subscribePresence, getPresenceSnapshot, getPresenceSnapshot);

  // Collapse all active specialist presences to one Jarwiz avatar. Prefer one
  // with a cursor; fall back to any active one.
  const active = Object.values(snapshot).find((p) => p?.active && p.cursor);
  if (!active?.cursor) return null;

  return <JarwizAvatar page={active.cursor} status={active.status} />;
}

export function JarwizAvatar({
  page,
  status,
}: {
  page: { x: number; y: number };
  status: string | null;
}) {
  const editor = useEditor();

  const screen = useValue(
    'jarwiz avatar',
    () => editor.pageToViewport(page),
    [editor, page.x, page.y],
  );

  return (
    <div
      className="jz-avatar jz-avatar--jarwiz"
      style={
        {
          transform: `translate(${screen.x - 18}px, ${screen.y - 18}px)`,
          '--agent-color': JARWIZ.color,
        } as CSSProperties
      }
    >
      <div className="jz-avatar-circle-wrap">
        <span className="jz-avatar-ring" aria-hidden />
        <div className="jz-avatar-circle" aria-label={JARWIZ.name}>
          <Sparkle size={16} strokeWidth={1.5} fill="currentColor" />
        </div>
      </div>
      <div className="jz-avatar-badge">
        <span className="jz-avatar-name">{JARWIZ.name}</span>
        {status ? <span className="jz-avatar-status">{status}</span> : null}
      </div>
    </div>
  );
}
