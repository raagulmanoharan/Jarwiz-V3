/**
 * The Ask affordance — anchored to the current card selection. Collapsed, it's
 * an "Ask AI" pill; clicked, it expands into an input where you type any
 * question. Submitting runs the Ask pipeline (useAsk), which drops an
 * auto-shaped answer card beside the source(s) with a provenance edge.
 *
 * Selecting two or more cards asks across them — that selection is the cluster.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Box, stopEventPropagation, useEditor, useValue } from 'tldraw';
import { useAsk } from './useAsk';
import { ensureSeedPrompts, getSeedPrompts, subscribeSeed, type SeedPrompt } from './seedPrompts';

const ASKABLE = new Set(['pdf-card', 'doc-card', 'table-card', 'note-card']);

/** One-tap refinements on an answer card — iterate without retyping. */
const FOLLOWUPS: Record<string, Array<{ label: string; prompt: string }>> = {
  'doc-card': [
    { label: 'Shorter', prompt: 'Rewrite this more concisely, keeping the key points.' },
    { label: 'Go deeper', prompt: 'Expand this with more detail and specifics from the source.' },
    { label: 'As a table', prompt: 'Reformat the key points of this as a comparison table.' },
  ],
  'table-card': [
    { label: 'As prose', prompt: 'Summarize this table as a short written explanation.' },
    { label: 'Go deeper', prompt: 'Expand this comparison with more detail from the source.' },
  ],
};

export function AskLayer() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
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
      // A single PDF card carries seed prompts (keyed by its asset id); a single
      // answer card carries follow-up refinements.
      const only = shapes.length === 1 ? shapes[0]! : null;
      const assetId =
        only?.type === 'pdf-card' ? String((only.props as { assetId?: string }).assetId ?? '') : '';
      const soleType = only?.type ?? '';
      return { ids: shapes.map((s) => s.id), x: pt.x, y: pt.y, count: shapes.length, assetId, soleType };
    },
    [editor],
  );

  // Seed prompts for a selected single PDF — fetched once, subscribed for updates.
  const assetId = selection?.assetId ?? '';
  useEffect(() => {
    if (assetId) ensureSeedPrompts(assetId);
  }, [assetId]);
  const seeds = useSyncExternalStore(
    subscribeSeed,
    () => (assetId ? getSeedPrompts(assetId) : undefined),
    () => undefined,
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

  const runSeed = (seed: SeedPrompt) => {
    if (isAsking) return;
    void ask(seed.prompt, selection.ids);
  };

  const style = { left: selection.x, top: selection.y + 14 } as CSSProperties;
  const showSeeds = !open && selection.count === 1 && Boolean(assetId) && (seeds?.length ?? 0) > 0;
  const followups = !open && selection.count === 1 ? (FOLLOWUPS[selection.soleType] ?? []) : [];

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
        <>
          {showSeeds
            ? seeds!.slice(0, 3).map((seed) => (
                <button
                  key={seed.label}
                  className="jz-ask-seed"
                  title={seed.prompt}
                  disabled={isAsking}
                  onClick={() => runSeed(seed)}
                >
                  {seed.label}
                </button>
              ))
            : null}
          {followups.map((f) => (
            <button
              key={f.label}
              className="jz-ask-seed"
              title={f.prompt}
              disabled={isAsking}
              onClick={() => runSeed(f)}
            >
              {f.label}
            </button>
          ))}
          <button className="jz-ask-pill" onClick={() => setOpen(true)}>
            <span className="jz-ask-spark" aria-hidden>
              ✦
            </span>
            {isAsking ? 'Asking…' : selection.count > 1 ? `Ask across ${selection.count}` : 'Ask AI'}
          </button>
        </>
      )}
    </div>
  );
}
