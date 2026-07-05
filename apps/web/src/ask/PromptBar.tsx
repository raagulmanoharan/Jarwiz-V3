/**
 * The canvas prompt bar — persistent query box at the bottom-centre.
 * Layout: tall rounded-rect, textarea top, footer row bottom.
 * Footer left: / (the response-shape MODE SELECTOR — typing "/" in an empty
 * input or clicking the button opens a menu of shapes the answer can take;
 * the pick pins a mode chip and forces that shape). Footer right: send.
 */

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { renderPlaintextFromRichText, stopEventPropagation, useEditor, useValue, type Editor, type TLRichText, type TLShape } from 'tldraw';
import { Slash, ArrowUp } from 'lucide-react';
import type { AnalyzeMode, AskShape } from '@jarwiz/shared';
import { ASKABLE, hasAskableContent } from './askable';
import { useAsk } from './useAsk';
import { useAnalyze } from '../agents/useAnalyze';
import { cardSeedKey, ensureCardSeeds, ensureSeedPrompts, getSeedPrompts, subscribeSeed } from './seedPrompts';

const clip = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function shapeLabel(editor: Editor, shape: TLShape): string {
  const p = shape.props as Record<string, unknown>;
  if (typeof p.title === 'string' && p.title.trim()) return clip(p.title.trim());
  if (shape.type === 'pdf-card') return typeof p.name === 'string' ? clip(String(p.name)) : 'PDF';
  let body = typeof p.text === 'string' ? p.text : '';
  if (!body && p.richText) { try { body = renderPlaintextFromRichText(editor, p.richText as TLRichText); } catch { /* ignore */ } }
  if (body.trim()) return clip(body.trim());
  const kind: Record<string, string> = { 'doc-card': 'Doc', 'note-card': 'Note', 'table-card': 'Table', 'diagram-card': 'Diagram', 'image-card': 'Image', 'link-card': 'Link', geo: 'Shape', text: 'Text', note: 'Note', frame: 'Section', arrow: 'Connector', group: 'Diagram' };
  return kind[shape.type] ?? 'Card';
}

const COACH_KEY = 'jz-coach-agents';

/** The "/" mode menu — every shape an answer can take. Stickies appear here
 *  deliberately: the router never chooses them (they're the user's annotation
 *  medium), but an explicit pick is user intent. */
const MODES: Array<{ shape: AskShape; label: string; hint: string }> = [
  { shape: 'doc', label: 'Text', hint: 'a written card' },
  { shape: 'list', label: 'List', hint: 'bullets or a checklist' },
  { shape: 'table', label: 'Table', hint: 'rows × columns' },
  { shape: 'diagram', label: 'Diagram', hint: 'boxes and arrows' },
  { shape: 'affinity', label: 'Stickies', hint: 'grouped sticky notes' },
];

export function PromptBar() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const { analyze, runningMode } = useAnalyze();
  const [value, setValue] = useState('');
  // The "/" mode selector: an explicitly chosen response shape, pinned as a
  // chip until the ask is sent (or the chip dismissed).
  const [mode, setMode] = useState<AskShape | null>(null);
  const [modeMenu, setModeMenu] = useState(false);
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
  // The sole selected card — only when it actually holds content (an empty
  // doc has nothing to ask about; a PDF mid-upload isn't readable). Pills are
  // generated from the card's own text — nothing scripted.
  const sole = useValue('promptbar-sole', () => {
    const ids = editor.getSelectedShapeIds();
    if (ids.length !== 1) return null;
    const s = editor.getShape(ids[0]!);
    if (!s || !hasAskableContent(editor, s)) return null;
    const p = s.props as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    if (s.type === 'pdf-card') return { type: s.type, seedKey: str(p.assetId), pdf: true as const };
    const text =
      s.type === 'table-card'
        ? [
            ...(Array.isArray(p.columns) ? [(p.columns as string[]).join(' | ')] : []),
            ...(Array.isArray(p.rows) ? (p.rows as string[][]).map((r) => r.join(' | ')) : []),
          ].join('\n')
        : s.type === 'diagram-card'
          ? str(p.code)
          : str(p.text);
    const title = str(p.title);
    return { type: s.type, seedKey: cardSeedKey(s.id, text, title), pdf: false as const, text, title };
  }, [editor]);
  useEffect(() => {
    if (!sole) return;
    if (sole.pdf) {
      ensureSeedPrompts(sole.seedKey);
      return;
    }
    // Debounced: the seed key fingerprints the card's TEXT, which changes on
    // every keystroke and every streaming delta. Fetch only after the content
    // has settled for a beat — otherwise a streaming answer mints hundreds of
    // keys and stampedes the server with seed generations.
    const t = setTimeout(() => ensureCardSeeds(sole.seedKey, sole.text ?? '', sole.title), 1200);
    return () => clearTimeout(t);
  }, [sole?.seedKey]);
  const seeds = useSyncExternalStore(
    subscribeSeed,
    () => (sole ? getSeedPrompts(sole.seedKey) : undefined),
    () => undefined,
  );

  const dismissCoach = () => { setCoachDone(true); try { localStorage.setItem(COACH_KEY, '1'); } catch {} };
  useEffect(() => { if (runningMode) dismissCoach(); }, [runningMode]);

  const pickMode = (shape: AskShape) => {
    setMode(shape);
    setModeMenu(false);
    // If the menu was opened by typing "/", swallow that slash.
    setValue((v) => (v.trim() === '/' ? '' : v));
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.jz-promptbar-input')?.focus());
  };

  const submit = () => {
    const q = value.trim();
    if (!q || isAsking) return;
    void ask(q, groundIds, mode ? { forceShape: mode } : undefined);
    setValue('');
    setMode(null); // the mode applies to one ask, like the text it rode with
  };
  const runTool = (mode: AnalyzeMode) => { void analyze(mode); };
  const useStarter = (q: string) => { setValue(q); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.jz-promptbar-input')?.focus()); };

  const placeholder = groundIds.length ? 'Ask about the selection…' : 'What would you like to change or create?';
  const busyLabel = runningMode ? (runningMode === 'tensions' ? 'Scanning…' : runningMode === 'gaps' ? 'Reviewing…' : 'Critiquing…') : null;

  const showChips = !runningMode && groundIds.length === 0 && boardCount >= 3;
  // Pills are ALWAYS contextual — generated from the card's own content.
  // Nothing scripted: until the tailored pills arrive (or if the card is
  // empty) we show nothing. Predictable operations live on the card's
  // floating bar (Refine), not here.
  const starters: Array<{ label: string; prompt: string }> =
    groundIds.length === 1 && (seeds?.length ?? 0) > 0
      ? seeds!.map((s) => ({ label: s.label, prompt: s.prompt }))
      : [];
  const showStarters = !runningMode && !value.trim() && starters.length > 0;
  // The 5-20s quiet gap while tailored pills are being generated (cache still
  // undefined = fetch in flight): show shimmering placeholder pills so the
  // wait reads as "thinking", not "nothing here" (feel pass, ROADMAP §10 #4).
  const showSeedWait =
    !runningMode && !value.trim() && groundIds.length === 1 && Boolean(sole) && seeds === undefined;
  const showCoach = !coachDone && boardCount >= 5;

  return (
    <div className="jz-promptbar-dock" onPointerDown={stopEventPropagation}>
      {/* The coach bubble is gone: it described the two scan chips rendered
          directly beneath it (redundant teaching, permanent until dismissed,
          and part of the bottom-centre chrome pile-up — dogfood finding). */}
      {showStarters ? (
        <div className="jz-promptbar-chips">
          {starters.map((s) => (
            <button key={s.label} className="jz-pb-chip" title="Use this prompt (editable)" onClick={() => useStarter(s.prompt)}>{s.label}</button>
          ))}
        </div>
      ) : showSeedWait ? (
        <div className="jz-promptbar-chips" aria-hidden>
          {[128, 164, 142].map((w) => (
            <span key={w} className="jz-pb-chip jz-pb-chip--wait" style={{ width: w }} />
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
        {ground.length > 0 || mode ? (
          <div className="jz-pb-grounds">
            {mode ? (
              <span className="jz-pb-ground jz-pb-mode" title="Answer shape — picked with /">
                {MODES.find((m) => m.shape === mode)?.label ?? mode}
                <button className="jz-pb-ground-x" aria-label="Clear answer shape" onClick={() => setMode(null)}>✕</button>
              </span>
            ) : null}
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
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            // Typing "/" in an empty input opens the mode menu (a "/" mid-
            // sentence is just a character).
            if (next.trim() === '/' && !modeMenu) setModeMenu(true);
            else if (modeMenu && next.trim() !== '/') setModeMenu(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!modeMenu) submit(); }
            if (e.key === 'Escape') {
              if (modeMenu) setModeMenu(false);
              else (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />

        {modeMenu ? (
          <div className="jz-mode-menu" role="menu" aria-label="Answer shape">
            <span className="jz-mode-menu-title">Answer as…</span>
            {MODES.map((m) => (
              <button key={m.shape} className="jz-mode-item" role="menuitem" onClick={() => pickMode(m.shape)}>
                <span className="jz-mode-item-label">{m.label}</span>
                <span className="jz-mode-item-hint">{m.hint}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="jz-promptbar-footer">
          <div className="jz-promptbar-footer-left">
            {/* The / button = the mode selector (same menu as typing "/").
                The old dead + (attach) stays gone until it does something. */}
            <button
              className={`jz-promptbar-icon-btn${modeMenu ? ' jz-promptbar-icon-btn--active' : ''}`}
              title="Answer shape (/)"
              aria-label="Choose the answer's shape"
              onClick={() => setModeMenu((v) => !v)}
            >
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
