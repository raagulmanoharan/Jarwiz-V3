/**
 * The comment thread — a card's conversation, shown beside it when the card is
 * selected. You comment; Jarwiz is a participant you can hand the thread to
 * with a tap (it replies in-line). Persisted per card (comments.ts).
 */

import { useState, type CSSProperties } from 'react';
import { useSyncExternalStore } from 'react';
import { Sparkle } from 'lucide-react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { JARWIZ } from '@jarwiz/shared';
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

  const askJarwiz = () => {
    const text = draft.trim();
    if (text) addComment(target.cardId, { author: 'you', text });
    setDraft('');
    // Server still picks the specialist; the comment author renders as Jarwiz.
    void ask(target.cardId, JARWIZ.routingId);
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
            const isAgent = m.author !== 'you';
            return (
              <div key={m.id} className="jz-comment">
                <div className="jz-comment-author">
                  {isAgent ? (
                    <span
                      className="jz-comment-dot"
                      style={{ '--agent-color': JARWIZ.color } as CSSProperties}
                    />
                  ) : null}
                  {isAgent ? JARWIZ.name : 'You'}
                </div>
                <div className="jz-comment-body">{m.text || '…'}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="jz-comments-empty">Leave a note, or ask Jarwiz about this card.</div>
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
        <button
          className="jz-comments-chip jz-comments-chip--jarwiz"
          style={{ '--agent-color': JARWIZ.color } as CSSProperties}
          title={`Ask ${JARWIZ.name}`}
          aria-label={`Ask ${JARWIZ.name}`}
          onClick={askJarwiz}
        >
          <Sparkle size={12} strokeWidth={1.7} fill="currentColor" />
          Ask Jarwiz
        </button>
      </div>
    </div>
  );
}
