/**
 * The comment thread — a card's conversation, shown beside it when the card is
 * selected. You comment; the agents are participants you can hand the thread to
 * with a tap (they reply in-line). Persisted per card (comments.ts).
 */

import { useState, type CSSProperties } from 'react';
import { useSyncExternalStore } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { AGENTS, getAgent, type AgentId } from '@jarwiz/shared';
import { addComment, getCommentsSnapshot, subscribeComments } from './comments';
import { isCardShape } from './runRequest';
import { useCommentReply } from './useCommentReply';

export function CommentThread() {
  const editor = useEditor();
  const snapshot = useSyncExternalStore(subscribeComments, getCommentsSnapshot, getCommentsSnapshot);
  const { ask } = useCommentReply();
  const [draft, setDraft] = useState('');

  const target = useValue(
    'jarwiz comment target',
    () => {
      if (editor.getEditingShapeId() !== null) return null;
      if (!editor.isIn('select.idle')) return null;
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const id = ids[0]!;
      const shape = editor.getShape(id);
      if (!isCardShape(shape)) return null;
      const b = editor.getShapePageBounds(id);
      if (!b) return null;
      const p = editor.pageToViewport({ x: b.maxX, y: b.minY });
      return { cardId: id, x: p.x, y: p.y };
    },
    [editor],
  );

  if (!target) return null;
  const thread = snapshot[target.cardId] ?? [];

  const postComment = () => {
    const text = draft.trim();
    if (!text) return;
    addComment(target.cardId, { author: 'you', text });
    setDraft('');
  };

  const askAgent = (agentId: AgentId) => {
    const text = draft.trim();
    if (text) addComment(target.cardId, { author: 'you', text });
    setDraft('');
    void ask(target.cardId, agentId);
  };

  return (
    <div
      className="jz-comments"
      style={{ left: target.x + 12, top: target.y }}
      onPointerDown={stopEventPropagation}
    >
      <div className="jz-comments-head">
        <span>Comments</span>
        {thread.length > 0 ? <span className="jz-comments-count">{thread.length}</span> : null}
      </div>

      {thread.length > 0 ? (
        <div className="jz-comments-list">
          {thread.map((m) => {
            const agent = m.author === 'you' ? null : getAgent(m.author);
            return (
              <div key={m.id} className="jz-comment">
                <div className="jz-comment-author">
                  {agent ? (
                    <span
                      className="jz-comment-dot"
                      style={{ '--agent-color': agent.color } as CSSProperties}
                    />
                  ) : null}
                  {agent ? agent.name : 'You'}
                </div>
                <div className="jz-comment-body">{m.text || '…'}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="jz-comments-empty">Leave a note, or ask an agent about this card.</div>
      )}

      <textarea
        className="jz-comments-input"
        value={draft}
        placeholder="Comment…"
        rows={2}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            postComment();
          }
        }}
      />

      <div className="jz-comments-actions">
        <span className="jz-comments-ask">Ask</span>
        {AGENTS.map((agent) => (
          <button
            key={agent.id}
            className="jz-comments-chip"
            style={{ '--agent-color': agent.color } as CSSProperties}
            title={`Ask ${agent.name}`}
            aria-label={`Ask ${agent.name}`}
            onClick={() => askAgent(agent.id)}
          >
            {agent.name[0]}
          </button>
        ))}
      </div>
    </div>
  );
}
