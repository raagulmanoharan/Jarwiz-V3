/**
 * Controls for the in-place streaming draft. They float just under the card as
 * it fills in: a quiet "generating" state while it streams, then Keep / Discard
 * so the user confirms the artefact is useful (or throws it away) — the
 * preview-before-commit idea, now on the canvas itself.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { getDraft, subscribeDraft } from './draft';
import { discardDraft, finalizeDraft } from './useAsk';

export function DraftControls() {
  const editor = useEditor();
  const draft = useSyncExternalStore(subscribeDraft, getDraft, getDraft);

  const anchor = useValue(
    'jarwiz draft controls anchor',
    () => {
      if (!draft) return null;
      const b = editor.getShapePageBounds(draft.id);
      if (!b) return null;
      const p = editor.pageToViewport({ x: b.midX, y: b.maxY });
      const vp = editor.getViewportScreenBounds();
      const x = Math.max(90, Math.min(p.x, vp.w - 90));
      const y = Math.max(40, Math.min(p.y + 12, vp.h - 44));
      return { x, y };
    },
    [editor, draft],
  );

  if (!draft || !anchor) return null;
  const style = { left: anchor.x, top: anchor.y } as CSSProperties;
  const keep = () => {
    finalizeDraft(editor);
  };
  const drop = () => discardDraft(editor);

  return (
    <div className="jz-draft" style={style} onPointerDown={stopEventPropagation}>
      {draft.status === 'streaming' ? (
        <>
          <span className="jz-draft-dot" aria-hidden />
          <span className="jz-draft-label">Generating…</span>
          <button className="jz-draft-discard" onClick={drop}>
            Stop &amp; discard
          </button>
        </>
      ) : draft.status === 'error' ? (
        <>
          <span className="jz-draft-err">{draft.error ?? 'Something went wrong.'}</span>
          <button className="jz-draft-discard" onClick={drop}>
            Discard
          </button>
        </>
      ) : (
        <>
          <button className="jz-draft-discard" onClick={drop}>
            Discard
          </button>
          <button className="jz-draft-keep" onClick={keep}>
            Keep
          </button>
        </>
      )}
    </div>
  );
}
