/**
 * Floating control for an in-place regeneration. While a selected answer card
 * is being rewritten (a same-type tweak), this shows "Regenerating…" with a
 * Cancel just under the card — the progress + escape hatch a streaming draft
 * gets, for the draftless in-place path. Cancel aborts the model call and
 * restores the card's previous content; otherwise the new version simply lands.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { getRegen, subscribeRegen } from './regen';
import { cancelActiveAsk } from './useAsk';

export function RegenControls() {
  const editor = useEditor();
  const regen = useSyncExternalStore(subscribeRegen, getRegen, getRegen);

  const anchor = useValue(
    'jarwiz regen controls anchor',
    () => {
      if (!regen) return null;
      const b = editor.getShapePageBounds(regen.id);
      if (!b) return null;
      const p = editor.pageToViewport({ x: b.midX, y: b.maxY });
      const vp = editor.getViewportScreenBounds();
      const x = Math.max(90, Math.min(p.x, vp.w - 90));
      const y = Math.max(40, Math.min(p.y + 12, vp.h - 44));
      return { x, y };
    },
    [editor, regen],
  );

  if (!regen || !anchor) return null;
  const style = { left: anchor.x, top: anchor.y } as CSSProperties;

  return (
    <div className="jz-draft" style={style} onPointerDown={stopEventPropagation}>
      <span className="jz-draft-dot" aria-hidden />
      <span className="jz-draft-label">Regenerating…</span>
      <button className="jz-draft-discard" onClick={() => cancelActiveAsk()}>
        Cancel
      </button>
    </div>
  );
}
