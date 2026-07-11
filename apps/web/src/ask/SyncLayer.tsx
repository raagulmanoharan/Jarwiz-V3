/**
 * Auto-sync surface: mounts the sync engine (sync.ts) and floats an "Updated"
 * pill under each card the engine refreshed — the quiet receipt that Jarwiz
 * changed something on its own, with Undo one click away. Same anatomy as the
 * draft/regen pills (useCardAnchor + jz-draft), so proactive work reads in the
 * app's own voice. While a card is mid-rewrite the RegenControls pill already
 * shows "Regenerating… / Cancel"; this one appears only once the update lands.
 */

import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor } from 'tldraw';
import { getRegen, subscribeRegen } from './regen';
import { clearSyncBadge, getSyncBadges, registerSyncEngine, subscribeSyncBadges, undoSync, type SyncBadge } from './sync';
import { useCardAnchor } from './useCardAnchor';
import { useAsk } from './useAsk';
import { JarwizSpark } from '../ui/JarwizSpark';

export function SyncLayer() {
  const editor = useEditor();
  const { ask } = useAsk();

  // The engine outlives any single `ask` identity (it changes as isAsking
  // flips); a ref hands it the current one without re-registering listeners.
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => registerSyncEngine(editor, askRef), [editor]);

  const badges = useSyncExternalStore(subscribeSyncBadges, getSyncBadges, getSyncBadges);
  if (badges.size === 0) return null;
  return (
    <>
      {[...badges.values()].map((b) => (
        <UpdatedPill key={b.cardId} badge={b} />
      ))}
    </>
  );
}

function UpdatedPill({ badge }: { badge: SyncBadge }) {
  const editor = useEditor();
  const anchor = useCardAnchor(badge.cardId);
  const regen = useSyncExternalStore(subscribeRegen, getRegen, getRegen);

  if (!anchor) return null;
  // A rewrite is streaming into this card right now — RegenControls owns the
  // spot under it; the badge returns when the stream ends.
  if (regen?.id === badge.cardId) return null;
  const style = { left: anchor.x, top: anchor.y } as CSSProperties;

  return (
    <div className="jz-draft jz-sync" style={style} onPointerDown={stopEventPropagation}>
      <span className="jz-sync-spark" aria-hidden>
        <JarwizSpark size={12} />
      </span>
      <span className="jz-draft-label">Updated to match “{badge.sourceLabel}”</span>
      <button className="jz-draft-discard" onClick={() => undoSync(editor, badge.cardId)}>
        Undo
      </button>
      <button className="jz-sync-dismiss" onClick={() => clearSyncBadge(badge.cardId)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
