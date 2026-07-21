/**
 * The disambiguation prompt. When an Ask is genuinely unclear the server asks
 * one short question instead of guessing. It renders as a wide card docked
 * directly above the composer (inside the prompt-bar dock, in place of the
 * chips) — a plain question, tappable suggestions, then an input. Answering
 * re-runs the same Ask with the answer folded in (and skips re-asking).
 */

import { useState, useSyncExternalStore } from 'react';
import { stopEventPropagation } from 'tldraw';
import { clearClarify, getClarify, subscribeClarify } from './clarify';
import { useAsk } from './useAsk';

export function ClarifyLayer() {
  const { ask, isAsking } = useAsk();
  const clarify = useSyncExternalStore(subscribeClarify, getClarify, getClarify);
  const [custom, setCustom] = useState('');

  if (!clarify) return null;

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
    <div className="jz-clarify" onPointerDown={stopEventPropagation}>
      <div className="jz-clarify-q">{clarify.question}</div>
      {clarify.options.length > 0 ? (
        <div className="jz-clarify-opts">
          {clarify.options.map((opt) => (
            <button key={opt} className="jz-clarify-opt" disabled={isAsking} onClick={() => answer(opt)}>
              {opt}
            </button>
          ))}
        </div>
      ) : null}
      <div className="jz-clarify-form">
        <input
          className="jz-clarify-input"
          value={custom}
          placeholder="Or type your answer…"
          autoFocus
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
