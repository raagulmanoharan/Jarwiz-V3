/**
 * Comment layer — the FigJam-style proactive comments Jarwiz pins to cards.
 * Each comment shows as a small pin on the card's top-right corner; clicking it
 * opens a popover with Jarwiz's note and two moves: let Jarwiz APPLY the fix (it
 * refines the card in place and glows the parts it changed — see fixHighlight)
 * or dismiss (which sticks, so it won't come back). A card whose format can't be
 * refined in place falls back to prefilling the prompt bar. Camera-tracked like
 * the other on-card affordances.
 */

import { useSyncExternalStore } from 'react';
import { stopEventPropagation, useEditor, useValue, type TLShapeId } from 'tldraw';
import { X, Wand2, AlertTriangle, Scale, HelpCircle, Lightbulb } from 'lucide-react';
import { JarwizSpark } from '../ui/JarwizSpark';
import type { NoticeKind } from '@jarwiz/shared';
import { getTheme, subscribeTheme } from '../ui/theme';
import { requestPromptFill } from './promptFill';
import { REFINABLE, useAsk } from './useAsk';
import {
  dismissComment,
  getComments,
  subscribeComments,
  toggleComment,
  closeComments,
  type BoardComment,
} from './comments';
import { useNotice } from './useNotice';

const KIND: Record<NoticeKind, { label: string; icon: React.ReactNode }> = {
  risk: { label: 'Heads up', icon: <AlertTriangle size={12} /> },
  tension: { label: 'Tension', icon: <Scale size={12} /> },
  gap: { label: 'Missing', icon: <HelpCircle size={12} /> },
  idea: { label: 'Idea', icon: <Lightbulb size={12} /> },
};

export function CommentLayer() {
  useSyncExternalStore(subscribeTheme, getTheme, getTheme); // re-skin on theme flip
  useNotice(); // drive the quiet auto-review from the layer that shows its output
  const state = useSyncExternalStore(subscribeComments, getComments, getComments);
  if (state.comments.length === 0) return null;
  return (
    <>
      {state.comments.map((c) => (
        <CommentPin key={c.id} comment={c} open={state.openId === c.id} />
      ))}
    </>
  );
}

function CommentPin({ comment, open }: { comment: BoardComment; open: boolean }) {
  const editor = useEditor();
  const { ask } = useAsk();
  // Anchor to the card's top-right corner, in viewport pixels; recompute on
  // every camera move. If the card is gone the pin simply hides (the comment
  // stays in the store — a filtered board shouldn't lose Jarwiz's notes).
  const pos = useValue(
    `jz-comment-pos ${comment.id}`,
    () => {
      const b = editor.getShapePageBounds(comment.cardId as TLShapeId);
      if (!b) return null;
      const p = editor.pageToViewport({ x: b.maxX, y: b.minY });
      return { x: p.x, y: p.y };
    },
    [editor, comment.cardId],
  );
  if (!pos) return null;
  const k = KIND[comment.kind];
  return (
    <div className="jz-comment" style={{ left: pos.x, top: pos.y }} onPointerDown={stopEventPropagation}>
      <button
        className={`jz-comment-pin jz-comment-pin--${comment.kind}${open ? ' jz-comment-pin--open' : ''}`}
        onClick={() => toggleComment(comment.id)}
        title="Jarwiz left a comment"
        aria-label="Open Jarwiz's comment"
      >
        <JarwizSpark size={12} />
      </button>
      {open ? (
        <div className="jz-comment-pop">
          <div className="jz-comment-head">
            <span className="jz-comment-avatar"><JarwizSpark size={12} /></span>
            <span className="jz-comment-name">Jarwiz</span>
            <span className={`jz-comment-kind jz-comment-kind--${comment.kind}`}>{k.icon}{k.label}</span>
            <button className="jz-comment-x" aria-label="Close" onClick={() => closeComments()}><X size={14} /></button>
          </div>
          <div className="jz-comment-body">{comment.body}</div>
          <div className="jz-comment-actions">
            {comment.suggestion ? (
              <button
                className="jz-comment-fix"
                onClick={() => {
                  const cardId = comment.cardId as TLShapeId;
                  const type = editor.getShape(cardId)?.type;
                  editor.select(cardId);
                  if (type && REFINABLE[type]) {
                    // Apply the fix straight to the card — no composer detour. The
                    // refine keeps the card's format and glows what it changed;
                    // the note is resolved, so it's dismissed.
                    void ask(comment.suggestion!, [cardId], {
                      targetId: cardId,
                      skipClarify: true,
                      logLabel: 'Applied a fix',
                      highlightChanges: true,
                    });
                    dismissComment(comment.id);
                  } else {
                    // A card whose format can't refine in place → prefill instead.
                    requestPromptFill(comment.suggestion!, cardId);
                    closeComments();
                  }
                }}
              >
                <Wand2 size={13} /> Let Jarwiz fix it
              </button>
            ) : null}
            <button className="jz-comment-dismiss" onClick={() => dismissComment(comment.id)}>Dismiss</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
