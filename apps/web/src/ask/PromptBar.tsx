/**
 * The canvas prompt bar — a persistent query box at the bottom-centre (Google
 * Stitch style) plus the opinion-agent launcher. Type a question or a "make
 * me…" and the answer streams onto the board; or run a board scan from the
 * "Agents" menu. When the board has content and nothing is selected, contextual
 * quick-action chips surface the scans (discoverability, P3), and a one-time
 * coachmark points at the launcher.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { renderPlaintextFromRichText, stopEventPropagation, useEditor, useValue, type Editor, type TLRichText, type TLShape } from 'tldraw';
import type { AnalyzeMode } from '@jarwiz/shared';
import { ASKABLE } from './AskLayer';
import { useAsk } from './useAsk';
import { useAnalyze } from '../agents/useAnalyze';

const clip = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A short label for a selected shape, shown as a grounding chip. */
function shapeLabel(editor: Editor, shape: TLShape): string {
  const p = shape.props as Record<string, unknown>;
  if (typeof p.title === 'string' && p.title.trim()) return clip(p.title.trim());
  if (shape.type === 'pdf-card') return typeof p.name === 'string' ? clip(String(p.name)) : 'PDF';
  let body = typeof p.text === 'string' ? p.text : '';
  if (!body && p.richText) { try { body = renderPlaintextFromRichText(editor, p.richText as TLRichText); } catch { /* ignore */ } }
  if (body.trim()) return clip(body.trim());
  const kind: Record<string, string> = { 'doc-card': 'Doc', 'note-card': 'Note', 'table-card': 'Table', 'diagram-card': 'Diagram', 'image-card': 'Image', 'link-card': 'Link', geo: 'Shape', text: 'Text', note: 'Note', frame: 'Section', arrow: 'Connector' };
  return kind[shape.type] ?? 'Card';
}

const TOOLS: Array<{ mode: AnalyzeMode; glyph: string; label: string; hint: string }> = [
  { mode: 'tensions', glyph: '⚖', label: 'Scan for tensions', hint: 'Find contradictions between cards' },
  { mode: 'gaps', glyph: '✦', label: "What am I missing?", hint: 'Name the due-diligence gaps on this board' },
  { mode: 'critique', glyph: '⚔', label: "Devil's advocate", hint: 'Tear apart the selection (or the board)' },
];

const COACH_KEY = 'jz-coach-agents';

export function PromptBar() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const { analyze, runningMode } = useAnalyze();
  const [value, setValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [coachDone, setCoachDone] = useState(() => {
    try { return localStorage.getItem(COACH_KEY) === '1'; } catch { return true; }
  });

  // Selected, askable shapes shown as removable chips — explicit grounding.
  const ground = useValue(
    'promptbar-ground',
    () => editor.getSelectedShapeIds()
      .map((id) => ({ id, shape: editor.getShape(id) }))
      .filter((x) => x.shape && ASKABLE.has(x.shape.type))
      .map((x) => ({ id: x.id, label: shapeLabel(editor, x.shape!) })),
    [editor],
  );
  const groundIds = ground.map((g) => g.id);
  const dropGround = (id: string) => {
    editor.setSelectedShapes(editor.getSelectedShapeIds().filter((x) => x !== id));
  };
  const boardCount = useValue('promptbar-boardcount', () => editor.getCurrentPageShapeIds().size, [editor]);

  const dismissCoach = () => { setCoachDone(true); try { localStorage.setItem(COACH_KEY, '1'); } catch {} };
  // Opening the menu (or running a tool) counts as learning it exists.
  useEffect(() => { if (menuOpen || runningMode) dismissCoach(); }, [menuOpen, runningMode]);

  const submit = () => {
    const q = value.trim();
    if (!q || isAsking) return;
    void ask(q, groundIds);
    setValue('');
  };
  const runTool = (mode: AnalyzeMode) => { setMenuOpen(false); void analyze(mode); };

  const placeholder = groundIds.length ? 'Ask about the selection…' : 'Ask anything, or describe what to create…';
  const busyLabel = runningMode ? (runningMode === 'tensions' ? 'Scanning…' : runningMode === 'gaps' ? 'Reviewing…' : 'Critiquing…') : null;

  // Contextual quick-actions: board has substance, nothing selected, idle.
  const showChips = !menuOpen && !runningMode && groundIds.length === 0 && boardCount >= 3;
  // Coachmark: board has grown, agents never used.
  const showCoach = !coachDone && !menuOpen && boardCount >= 5;

  return (
    <div className="jz-promptbar-dock" onPointerDown={stopEventPropagation}>
      {showCoach ? (
        <div className="jz-coach" role="dialog">
          <span className="jz-coach-text">✦ Your agents can scan this whole board — tensions, gaps, a critique.</span>
          <button className="jz-coach-dismiss" onClick={dismissCoach}>Got it</button>
        </div>
      ) : null}

      {showChips ? (
        <div className="jz-promptbar-chips">
          <button className="jz-pb-chip" title="Find contradictions between cards" onClick={() => runTool('tensions')}>⚖ Scan for tensions</button>
          <button className="jz-pb-chip" title="Name the due-diligence gaps on this board" onClick={() => runTool('gaps')}>✦ What am I missing?</button>
        </div>
      ) : null}

      <div className="jz-promptbar" style={{ '--pb-max': '600px' } as CSSProperties}>
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
                <button key={t.mode} className="jz-promptbar-menuitem" title={t.hint} disabled={Boolean(runningMode)} onClick={() => runTool(t.mode)}>
                  <span className="jz-promptbar-menuglyph" aria-hidden>{t.glyph}</span>
                  <span className="jz-promptbar-menulabel">{t.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {ground.length > 0 ? (
          <div className="jz-pb-grounds">
            {ground.slice(0, 3).map((g) => (
              <span key={g.id} className="jz-pb-ground" title={g.label}>
                {g.label}
                <button className="jz-pb-ground-x" aria-label="Remove from context" onClick={() => dropGround(g.id)}>✕</button>
              </span>
            ))}
            {ground.length > 3 ? <span className="jz-pb-ground jz-pb-ground--more">+{ground.length - 3}</span> : null}
          </div>
        ) : null}
        <input
          className="jz-promptbar-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
        <button className="jz-promptbar-send" disabled={!value.trim() || isAsking} onClick={submit} title="Ask (Enter)">
          {isAsking ? '…' : '↑'}
        </button>
      </div>
    </div>
  );
}
