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
import { useDiagram } from '../agents/useDiagram';
import { canTidy, useTidy } from '../agents/useTidy';
import { useCluster } from '../agents/useCluster';
import { useCardAnchor } from './useCardAnchor';
import { getRegen, subscribeRegen } from './regen';
import { getClarify, subscribeClarify } from './clarify';
import { ensureSeedPrompts, getSeedPrompts, subscribeSeed, type SeedPrompt } from './seedPrompts';

// Rich cards plus native primitives (canvas pivot P1): a selected shape, label,
// or hand-drawn cluster is askable, so "create something from this" works on a
// sketch, not just cards.
const ASKABLE = new Set([
  'pdf-card', 'doc-card', 'table-card', 'diagram-card', 'note-card', 'image-card',
  'geo', 'text', 'note', 'arrow', 'frame',
]);

/** Human label per shape type — folded into the pill on a multi-select so it's
 *  clear what an Ask will combine ("Ask across 2 · Doc · Shape"). */
const KIND_LABEL: Record<string, string> = {
  'pdf-card': 'PDF',
  'doc-card': 'Doc',
  'table-card': 'Table',
  'diagram-card': 'Diagram',
  'note-card': 'Note',
  'image-card': 'Image',
  geo: 'Shape',
  text: 'Text',
  note: 'Note',
  arrow: 'Connector',
  frame: 'Section',
};

/** Answer cards that refine in place — a same-type tweak rewrites the selected
 *  card rather than spawning a new one (useAsk passes it as the target). */
const RESPONSE_CARDS = new Set(['doc-card', 'table-card', 'diagram-card']);

/** One-tap refinements on an answer card — iterate without retyping. The
 *  prose/table/diagram chips name the format unambiguously so the server routes
 *  a format change to a NEW card, while same-type tweaks update in place. */
const FOLLOWUPS: Record<string, Array<{ label: string; prompt: string }>> = {
  'pdf-card': [
    { label: 'Diagram', prompt: 'Create a diagram that captures how this document works.' },
    { label: 'Brainstorm', prompt: 'Brainstorm ideas from this document as clustered sticky notes.' },
    { label: 'Action items', prompt: 'Extract the action items from this document as a checklist.' },
  ],
  'doc-card': [
    { label: 'Shorter', prompt: 'Rewrite this more concisely, keeping the key points.' },
    { label: 'Go deeper', prompt: 'Expand this with more detail and specifics.' },
    { label: 'As a table', prompt: 'Reformat the key points of this as a comparison table.' },
    { label: 'As a diagram', prompt: 'Turn the key points of this into a diagram.' },
  ],
  'table-card': [
    { label: 'Add a row', prompt: 'Add another relevant row to this comparison.' },
    { label: 'As a diagram', prompt: 'Turn this comparison into a diagram.' },
    { label: 'As prose', prompt: 'Rewrite the key points as a short written summary.' },
  ],
  'diagram-card': [
    { label: 'Add detail', prompt: 'Add more nodes and detail to this, keeping the same kind of diagram.' },
    { label: 'Simplify', prompt: 'Simplify this to just the essential nodes, keeping the same kind of diagram.' },
    { label: 'As prose', prompt: 'Rewrite the key points as a short written summary.' },
  ],
};

export function AskLayer() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const { diagram, isDiagramming } = useDiagram();
  const { tidy } = useTidy();
  const { cluster, isClustering } = useCluster();
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
      const pdfCount = shapes.filter((s) => s.type === 'pdf-card').length;
      const noteCount = shapes.filter((s) => s.type === 'note-card').length;
      // A readable summary of what a multi-select would combine, e.g. "Doc · Table · Image".
      const kindLabel = [...new Set(shapes.map((s) => KIND_LABEL[s.type] ?? 'Card'))].join(' · ');
      return { ids: shapes.map((s) => s.id), count: shapes.length, assetId, soleType, pdfCount, noteCount, kindLabel };
    },
    [editor],
  );
  // Shared anchor maths (bounds → viewport → clamp), used by every affordance.
  const anchor = useCardAnchor(selection?.ids ?? null, { dy: 14 });
  // The selection spot is shared: when a clarifying question or an in-place
  // regeneration is showing there, it owns the slot — don't stack the pill on it.
  const regen = useSyncExternalStore(subscribeRegen, getRegen, getRegen);
  const clarify = useSyncExternalStore(subscribeClarify, getClarify, getClarify);

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

  if (!selection || !anchor) return null;
  // Mutual exclusion: a pending question or a running regeneration owns this spot.
  if (clarify || regen) return null;

  // A single selected answer card is the in-place refinement target — typing a
  // tweak ("add a node", "make it shorter") rewrites it instead of branching.
  const targetId =
    selection.count === 1 && RESPONSE_CARDS.has(selection.soleType) ? selection.ids[0] : null;

  const submit = () => {
    if (!value.trim() || isAsking) return;
    void ask(value, selection.ids, { targetId });
    setValue('');
    setOpen(false);
  };

  const runSeed = (seed: SeedPrompt) => {
    if (isAsking) return;
    void ask(seed.prompt, selection.ids, { targetId });
  };

  const style = { left: anchor.x, top: anchor.y } as CSSProperties;
  // A connected multi-selection (a flowchart) can be auto-laid-out in place.
  const showTidy = !open && selection.count >= 2 && canTidy(editor, selection.ids);
  // ≥3 sticky notes → offer to cluster them into named themes + a summary.
  const showCluster = !open && (selection.noteCount ?? 0) >= 3;
  const showSeeds = !open && selection.count === 1 && Boolean(assetId) && (seeds?.length ?? 0) > 0;
  const followups = !open && selection.count === 1 ? (FOLLOWUPS[selection.soleType] ?? []) : [];
  // Cross-document affordances when two or more PDFs are selected.
  const crossDoc =
    !open && selection.pdfCount >= 2
      ? [
          { label: 'Find conflicts', prompt: 'Find conflicts and contradictions between these documents, clause by clause.' },
          { label: 'Compare clauses', prompt: 'Compare these documents clause by clause, showing where each one stands and where they differ.' },
        ]
      : [];

  return (
    <div className="jz-asklayer" style={style} onPointerDown={stopEventPropagation}>
      {open ? (
        <div className="jz-ask-form">
          <input
            ref={inputRef}
            className="jz-ask-input"
            value={value}
            placeholder={
              selection.count > 1
                ? `Ask across ${selection.count} cards…`
                : targetId
                  ? 'Tweak this, or ask anything…'
                  : 'Ask anything about this…'
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
          <button className="jz-ask-pill" onClick={() => setOpen(true)}>
            <span className="jz-ask-spark" aria-hidden>
              ✦
            </span>
            {isAsking
              ? 'Asking…'
              : selection.count > 1
                ? `Ask across ${selection.count} · ${selection.kindLabel}`
                : 'Ask AI'}
          </button>
          <button
            className="jz-ask-seed"
            title="Build an editable flowchart from this (shapes + connectors you can tweak)"
            disabled={isDiagramming || isAsking}
            onClick={() => diagram('Turn this into a flowchart.', selection.ids)}
          >
            {isDiagramming ? 'Diagramming…' : '◇ Flowchart'}
          </button>
          {showTidy ? (
            <button
              className="jz-ask-seed"
              title="Auto-layout these connected shapes into a clean flow"
              onClick={() => tidy(selection.ids)}
            >
              ⤢ Tidy
            </button>
          ) : null}
          {showCluster ? (
            <button
              className="jz-ask-seed"
              title="Group these notes into named themes and summarise them"
              disabled={isClustering}
              onClick={() => cluster()}
            >
              {isClustering ? 'Clustering…' : '✦ Cluster & summarise'}
            </button>
          ) : null}
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
          {[...followups, ...crossDoc].map((f) => (
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
        </>
      )}
    </div>
  );
}
