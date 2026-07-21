/**
 * The disambiguation prompt. When an Ask is genuinely unclear the server asks
 * one short question instead of guessing; this floats it under the source(s)
 * with a few tappable options and a free-text fallback. Answering re-runs the
 * same Ask with the answer folded in (and skips re-asking).
 */

import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor } from 'tldraw';
import { clearClarify, getClarify, subscribeClarify } from './clarify';
import { useCardAnchor } from './useCardAnchor';
import { useAsk } from './useAsk';
import { JarwizSpark } from '../ui/JarwizSpark';

export function ClarifyLayer() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const clarify = useSyncExternalStore(subscribeClarify, getClarify, getClarify);
  const [custom, setCustom] = useState('');
  // Anchor under the union of the source cards this question is about. The wide
  // bubble needs more horizontal margin to stay on-screen.
  const anchor = useCardAnchor(clarify?.sourceIds ?? null, { dy: 14, margin: 170 });

  if (!clarify) return null;
  // An UNSELECTED ask has no source card to sit under (and its placeholder was
  // retired when the clarify came back), so `anchor` is null. Rather than render
  // nothing — which reads as "I typed, a card flashed, then nothing happened" —
  // dock the question above the composer, where the person is already looking.
  const vp = editor.getViewportScreenBounds();
  const style: CSSProperties = anchor
    ? { left: anchor.x, top: anchor.y }
    : { left: vp.w / 2, top: Math.max(80, vp.h - 250) };

  const answer = (text: string) => {
    const a = text.trim();
    if (!a || isAsking) return;
    const c = clarify;
    clearClarify();
    setCustom('');
    if (c.onAnswer) {
      c.onAnswer(a);
      return;
    }
    void ask(`${c.prompt}\n\n(${a})`, c.sourceIds, { targetId: c.targetId, skipClarify: true });
  };

  return (
    <div className="jz-clarify" style={style} onPointerDown={stopEventPropagation}>
      <div className="jz-clarify-q">
        <span className="jz-clarify-spark" aria-hidden><JarwizSpark size={12} /></span>
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
