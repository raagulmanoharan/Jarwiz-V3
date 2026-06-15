/**
 * The Ask affordance — anchored to the current card selection. Collapsed, it's
 * an "Ask AI" pill; clicked, it expands into an input where you type any
 * question. Submitting runs the Ask pipeline (useAsk), which drops an
 * auto-shaped answer card beside the source(s) with a provenance edge.
 *
 * Selecting two or more cards asks across them — that selection is the cluster.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Box, stopEventPropagation, useEditor, useValue } from 'tldraw';
import { useAsk } from './useAsk';

const ASKABLE = new Set(['pdf-card', 'doc-card', 'table-card', 'note-card']);

export function AskLayer() {
  const editor = useEditor();
  const { ask, isAsking, error } = useAsk();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The selected, askable cards and their combined viewport anchor.
  const selection = useValue(
    'jarwiz ask selection',
    () => {
      const shapes = editor
        .getSelectedShapeIds()
        .map((id) => editor.getShape(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s) && ASKABLE.has(s!.type));
      if (shapes.length === 0) return null;
      const boxes = shapes
        .map((s) => editor.getShapePageBounds(s.id))
        .filter((b): b is Box => Boolean(b));
      if (boxes.length === 0) return null;
      const union = boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
      const pt = editor.pageToViewport({ x: union.midX, y: union.maxY });
      return { ids: shapes.map((s) => s.id), x: pt.x, y: pt.y, count: shapes.length };
    },
    [editor],
  );

  // Collapse the input whenever the selection changes or clears.
  const key = selection?.ids.join(',') ?? '';
  useEffect(() => {
    setOpen(false);
    setValue('');
  }, [key]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!selection) return null;

  const submit = () => {
    if (!value.trim() || isAsking) return;
    void ask(value, selection.ids);
    setValue('');
    setOpen(false);
  };

  const style = { left: selection.x, top: selection.y + 14 } as CSSProperties;

  return (
    <div className="jz-ask" style={style} onPointerDown={stopEventPropagation}>
      {open ? (
        <div className="jz-ask-form">
          <input
            ref={inputRef}
            className="jz-ask-input"
            value={value}
            placeholder={
              selection.count > 1 ? `Ask across ${selection.count} cards…` : 'Ask anything about this…'
            }
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <button className="jz-ask-send" disabled={!value.trim() || isAsking} onClick={submit}>
            {isAsking ? '…' : 'Ask'}
          </button>
        </div>
      ) : (
        <button className="jz-ask-pill" onClick={() => setOpen(true)}>
          <span className="jz-ask-spark" aria-hidden>
            ✦
          </span>
          {isAsking ? 'Asking…' : selection.count > 1 ? `Ask across ${selection.count}` : 'Ask AI'}
        </button>
      )}
      {error ? <span className="jz-ask-error">{error}</span> : null}
    </div>
  );
}
