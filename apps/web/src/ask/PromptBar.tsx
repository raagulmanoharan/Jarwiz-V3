/**
 * The canvas prompt bar — persistent query box at the bottom-centre.
 * Layout: tall rounded-rect, textarea top, footer row bottom.
 * Footer left: + (attach) · / (commands). Footer right: send arrow.
 */

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { renderPlaintextFromRichText, stopEventPropagation, useEditor, useValue, type Editor, type TLRichText, type TLShape } from 'tldraw';
import { Plus, Slash, ArrowUp } from 'lucide-react';
import type { AnalyzeMode } from '@jarwiz/shared';
import { ASKABLE, hasAskableContent } from './askable';
import { useAsk } from './useAsk';
import { useAnalyze } from '../agents/useAnalyze';
import { ensureSeedPrompts, getSeedPrompts, subscribeSeed } from './seedPrompts';

const clip = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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

const COACH_KEY = 'jz-coach-agents';

const STARTERS: Record<string, string[]> = {
  'doc-card': ["What's the weakest part of this?", "What's missing here?", 'Summarise this in 3 bullets'],
  'note-card': ['Expand this into a doc', "What's the counter-argument?"],
  'table-card': ['Which option wins, and why?', "What's missing from this table?"],
  'pdf-card': ['Summarise the key points', 'What should I worry about here?'],
  'diagram-card': ['Explain this flow', "Where's the failure point?"],
  'image-card': ["What's notable in this image?"],
  default: ["What's most important here?", 'What would a skeptic ask?'],
};

export function PromptBar() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const { analyze, runningMode } = useAnalyze();
  const [value, setValue] = useState('');
  const [coachDone, setCoachDone] = useState(() => {
    try { return localStorage.getItem(COACH_KEY) === '1'; } catch { return true; }
  });

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
  // The sole selected card's type — but only when the card actually holds
  // content. An empty doc has nothing to "summarise in 3 bullets"; a PDF
  // mid-upload isn't readable. No content → no starter chips.
  const soleType = useValue('promptbar-soletype', () => {
    const ids = editor.getSelectedShapeIds();
    if (ids.length !== 1) return '';
    const s = editor.getShape(ids[0]!);
    return s && hasAskableContent(editor, s) ? s.type : '';
  }, [editor]);
  const assetId = useValue('promptbar-assetid', () => {
    const ids = editor.getSelectedShapeIds();
    if (ids.length !== 1) return '';
    const s = editor.getShape(ids[0]!);
    return s?.type === 'pdf-card' ? String((s.props as { assetId?: string }).assetId ?? '') : '';
  }, [editor]);
  useEffect(() => { if (assetId) ensureSeedPrompts(assetId); }, [assetId]);
  const seeds = useSyncExternalStore(
    subscribeSeed,
    () => (assetId ? getSeedPrompts(assetId) : undefined),
    () => undefined,
  );

  const dismissCoach = () => { setCoachDone(true); try { localStorage.setItem(COACH_KEY, '1'); } catch {} };
  useEffect(() => { if (runningMode) dismissCoach(); }, [runningMode]);

  const submit = () => {
    const q = value.trim();
    if (!q || isAsking) return;
    void ask(q, groundIds);
    setValue('');
  };
  const runTool = (mode: AnalyzeMode) => { void analyze(mode); };
  const useStarter = (q: string) => { setValue(q); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.jz-promptbar-input')?.focus()); };

  const placeholder = groundIds.length ? 'Ask about the selection…' : 'What would you like to change or create?';
  const busyLabel = runningMode ? (runningMode === 'tensions' ? 'Scanning…' : runningMode === 'gaps' ? 'Reviewing…' : 'Critiquing…') : null;

  const showChips = !runningMode && groundIds.length === 0 && boardCount >= 3;
  const starters: Array<{ label: string; prompt: string }> =
    groundIds.length !== 1
      ? []
      : assetId && (seeds?.length ?? 0) > 0
        ? seeds!.map((s) => ({ label: s.label, prompt: s.prompt }))
        : soleType // empty card → no chips at all (never fall through to defaults)
          ? (STARTERS[soleType] ?? STARTERS.default ?? []).map((s) => ({ label: s, prompt: s }))
          : [];
  const showStarters = !runningMode && !value.trim() && starters.length > 0;
  const showCoach = !coachDone && boardCount >= 5;

  return (
    <div className="jz-promptbar-dock" onPointerDown={stopEventPropagation}>
      {showCoach ? (
        <div className="jz-coach" role="dialog">
          <span className="jz-coach-text">✦ Jarwiz can scan this whole board — find tensions, or what you're missing.</span>
          <button className="jz-coach-dismiss" onClick={dismissCoach}>Got it</button>
        </div>
      ) : null}

      {showStarters ? (
        <div className="jz-promptbar-chips">
          {starters.map((s) => (
            <button key={s.label} className="jz-pb-chip" title="Use this prompt (editable)" onClick={() => useStarter(s.prompt)}>{s.label}</button>
          ))}
        </div>
      ) : null}

      {showChips ? (
        <div className="jz-promptbar-chips">
          <button className="jz-pb-chip" title="Find contradictions between cards" onClick={() => runTool('tensions')}>⚖ Scan for tensions</button>
          <button className="jz-pb-chip" title="Name the due-diligence gaps on this board" onClick={() => runTool('gaps')}>✦ What am I missing?</button>
        </div>
      ) : null}

      <div className="jz-promptbar" style={{ '--pb-max': '560px' } as CSSProperties}>
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

        <textarea
          className="jz-promptbar-input"
          value={value}
          rows={2}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
          }}
        />

        <div className="jz-promptbar-footer">
          <div className="jz-promptbar-footer-left">
            <button className="jz-promptbar-icon-btn" title="Attach" onClick={() => console.info('[jarwiz] attach coming soon')}>
              <Plus size={16} strokeWidth={1.8} />
            </button>
            <button className="jz-promptbar-icon-btn" title="Commands" onClick={() => console.info('[jarwiz] commands coming soon')}>
              <Slash size={16} strokeWidth={1.8} />
            </button>
          </div>
          <button
            className="jz-promptbar-send"
            disabled={!value.trim() || isAsking}
            onClick={submit}
            title="Send (Enter)"
          >
            {busyLabel ? <span className="jz-promptbar-busy-inline">{busyLabel}</span> : <ArrowUp size={16} strokeWidth={2.2} />}
          </button>
        </div>
      </div>
    </div>
  );
}
