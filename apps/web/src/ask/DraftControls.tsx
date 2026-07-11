/**
 * Controls for the in-place streaming draft. They float just under the card as
 * it fills in: a quiet "generating" state while it streams, then Keep / Discard
 * so the user confirms the artefact is useful (or throws it away) — the
 * preview-before-commit idea, now on the canvas itself.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor } from 'tldraw';
import { getDraft, subscribeDraft } from './draft';
import { useCardAnchor } from './useCardAnchor';
import { discardDraft, finalizeDraft } from './useAsk';
import { JarwizSpark } from '../ui/JarwizSpark';

export function DraftControls() {
  const editor = useEditor();
  const draft = useSyncExternalStore(subscribeDraft, getDraft, getDraft);
  // Never over the artefact's own text: a tall card would otherwise get the
  // bar clamped up over its content — flip above the card instead (G4.1).
  const anchor = useCardAnchor(draft?.id ?? null, { flipWhenCovered: true });

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
          <span className="jz-draft-spark" aria-hidden>
            <JarwizSpark size={12} />
          </span>
          {/* Narrate the actual stage when the server reports one — the wait
              should read as work, not as one frozen word (G3.1). */}
          <span className="jz-draft-label">{draft.statusText ?? 'Generating…'}</span>
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
