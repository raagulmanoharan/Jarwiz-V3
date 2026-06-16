/**
 * The disambiguation prompt. When an Ask is genuinely unclear the server asks
 * one short question instead of guessing; this floats it under the source(s)
 * with a few tappable options and a free-text fallback. Answering re-runs the
 * same Ask with the answer folded in (and skips re-asking).
 */

import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Box, stopEventPropagation, useEditor, useValue } from 'tldraw';
import { clearClarify, getClarify, subscribeClarify } from './clarify';
import { useAsk } from './useAsk';

export function ClarifyLayer() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const clarify = useSyncExternalStore(subscribeClarify, getClarify, getClarify);
  const [custom, setCustom] = useState('');

  // Anchor under the union of the source cards this question is about.
  const anchor = useValue(
    'jarwiz clarify anchor',
    () => {
      if (!clarify) return null;
      const boxes = clarify.sourceIds
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is Box => Boolean(b));
      if (boxes.length === 0) return null;
      const union = boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
      const p = editor.pageToViewport({ x: union.midX, y: union.maxY });
      const vp = editor.getViewportScreenBounds();
      return { x: Math.max(180, Math.min(p.x, vp.w - 180)), y: Math.min(p.y + 14, vp.h - 80) };
    },
    [editor, clarify],
  );

  if (!clarify || !anchor) return null;
  const style = { left: anchor.x, top: anchor.y } as CSSProperties;

  const answer = (text: string) => {
    const a = text.trim();
    if (!a || isAsking) return;
    const c = clarify;
    clearClarify();
    setCustom('');
    void ask(`${c.prompt}\n\n(${a})`, c.sourceIds, { targetId: c.targetId, skipClarify: true });
  };

  return (
    <div className="jz-clarify" style={style} onPointerDown={stopEventPropagation}>
      <div className="jz-clarify-q">
        <span className="jz-clarify-spark" aria-hidden>
          ✦
        </span>
        {clarify.question}
      </div>
      <div className="jz-clarify-opts">
        {clarify.options.map((opt) => (
          <button key={opt} className="jz-clarify-opt" disabled={isAsking} onClick={() => answer(opt)}>
            {opt}
          </button>
        ))}
      </div>
      <div className="jz-clarify-form">
        <input
          className="jz-clarify-input"
          value={custom}
          placeholder="Or say what you want…"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') answer(custom);
            if (e.key === 'Escape') clearClarify();
          }}
        />
        <button className="jz-clarify-dismiss" title="Dismiss" onClick={() => clearClarify()}>
          ×
        </button>
      </div>
    </div>
  );
}
