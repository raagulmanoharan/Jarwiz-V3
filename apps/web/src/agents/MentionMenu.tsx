/**
 * The @mention picker — appears above a card when you type "@", listing the
 * agents you can call on by name. Screen-space (crisp at any zoom), anchored to
 * the card it belongs to. Picking one summons it on that card.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { commitMention, filteredAgents, getMention, subscribeMention } from './mention';

export function MentionMenu() {
  const editor = useEditor();
  const mention = useSyncExternalStore(subscribeMention, getMention, getMention);

  const anchor = useValue(
    'jarwiz mention anchor',
    () => {
      if (!mention) return null;
      const bounds = editor.getShapePageBounds(mention.cardId);
      if (!bounds) return null;
      const p = editor.pageToViewport({ x: bounds.minX, y: bounds.minY });
      // Flip below the card top when there isn't room for the menu above it.
      return { x: p.x, y: p.y, below: p.y < 230 };
    },
    [editor, mention],
  );

  if (!mention || !anchor) return null;
  const agents = filteredAgents(mention.query);
  if (agents.length === 0) return null;

  return (
    <div
      className={`jz-mention${anchor.below ? ' jz-mention-below' : ''}`}
      style={{ left: anchor.x, top: anchor.y }}
      onPointerDown={stopEventPropagation}
    >
      <div className="jz-mention-head">Ask an agent</div>
      {agents.map((agent) => (
        <button
          key={agent.id}
          className="jz-mention-item"
          style={{ '--agent-color': agent.color } as CSSProperties}
          onClick={() => commitMention(editor, mention.cardId, agent.id)}
        >
          <span className="jz-mention-avatar">{agent.name[0]}</span>
          <span className="jz-mention-meta">
            <span className="jz-mention-name">{agent.name}</span>
            <span className="jz-mention-tagline">{agent.tagline}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
