/**
 * The canvas prompt bar — a persistent query box at the bottom-centre (Google
 * Stitch style). Type a question or a "make me…" and the answer streams onto the
 * board as a card. If askable shapes are selected, the query is grounded in them
 * ("Ask across 3"); otherwise it's a free-standing query placed in view.
 *
 * Its tools button (✦) opens the opinion agents — scan for tensions, what am I
 * missing, and Devil's advocate — which the parked roster would otherwise host.
 */

import { useState, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import type { AnalyzeMode } from '@jarwiz/shared';
import { ASKABLE } from './AskLayer';
import { useAsk } from './useAsk';
import { useAnalyze } from '../agents/useAnalyze';

const TOOLS: Array<{ mode: AnalyzeMode; glyph: string; label: string; hint: string }> = [
  { mode: 'tensions', glyph: '⚖', label: 'Scan for tensions', hint: 'Find contradictions between cards' },
  { mode: 'gaps', glyph: '✦', label: "What am I missing?", hint: 'Name the due-diligence gaps on this board' },
  { mode: 'critique', glyph: '⚔', label: "Devil's advocate", hint: 'Tear apart the selection (or the board)' },
];

export function PromptBar() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const { analyze, runningMode } = useAnalyze();
  const [value, setValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

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

  const runTool = (mode: AnalyzeMode) => {
    setMenuOpen(false);
    void analyze(mode);
  };

  const placeholder = groundIds.length
    ? `Ask across ${groundIds.length} selected…`
    : 'Ask anything, or describe what to create…';
  const busyLabel = runningMode
    ? runningMode === 'tensions'
      ? 'Scanning…'
      : runningMode === 'gaps'
        ? 'Reviewing…'
        : 'Critiquing…'
    : null;

  return (
    <div className="jz-promptbar" style={{ '--pb-max': '600px' } as CSSProperties} onPointerDown={stopEventPropagation}>
      <div className="jz-promptbar-tools-wrap">
        <button
          className={`jz-promptbar-tools${menuOpen ? ' jz-promptbar-tools--open' : ''}`}
          title="Agents — scan for tensions, gaps, or a critique"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {busyLabel ? (
            <span className="jz-promptbar-busy">{busyLabel}</span>
          ) : (
            <>
              <span aria-hidden>✦</span>
              <span className="jz-promptbar-tools-label">Agents</span>
              <span className="jz-promptbar-tools-caret" aria-hidden>▾</span>
            </>
          )}
        </button>
        {menuOpen ? (
          <div className="jz-promptbar-menu" role="menu">
            {TOOLS.map((t) => (
              <button
                key={t.mode}
                className="jz-promptbar-menuitem"
                title={t.hint}
                disabled={Boolean(runningMode)}
                onClick={() => runTool(t.mode)}
              >
                <span className="jz-promptbar-menuglyph" aria-hidden>{t.glyph}</span>
                <span className="jz-promptbar-menulabel">{t.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
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
