/**
 * The canvas prompt bar — a persistent query box at the bottom-centre (Google
 * Stitch style). Type a question or a "make me…" and the answer streams onto the
 * board as a card. If askable shapes are selected, the query is grounded in them
 * ("Ask across 3"); otherwise it's a free-standing query placed in view.
 *
 * It deliberately sits just above the primitive toolbar so both stay reachable.
 */

import { useState, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { ASKABLE } from './AskLayer';
import { useAsk } from './useAsk';

export function PromptBar() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const [value, setValue] = useState('');

  // Askable shapes currently selected — the query grounds in them when present.
  const groundIds = useValue(
    'promptbar-ground',
    () => editor.getSelectedShapeIds().filter((id) => {
      const t = editor.getShape(id)?.type;
      return t ? ASKABLE.has(t) : false;
    }),
    [editor],
  );

  const submit = () => {
    const q = value.trim();
    if (!q || isAsking) return;
    void ask(q, groundIds);
    setValue('');
  };

  const placeholder = groundIds.length
    ? `Ask across ${groundIds.length} selected…`
    : 'Ask anything, or describe what to create…';

  return (
    <div className="jz-promptbar" style={{ '--pb-max': '600px' } as CSSProperties} onPointerDown={stopEventPropagation}>
      <span className="jz-promptbar-spark" aria-hidden>✦</span>
      <input
        className="jz-promptbar-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Keep canvas shortcuts from firing while typing here.
          e.stopPropagation();
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      <button
        className="jz-promptbar-send"
        disabled={!value.trim() || isAsking}
        onClick={submit}
        title="Ask (Enter)"
      >
        {isAsking ? '…' : '↑'}
      </button>
    </div>
  );
}
