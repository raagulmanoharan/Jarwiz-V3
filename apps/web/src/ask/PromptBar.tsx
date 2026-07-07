/**
 * The canvas prompt bar — persistent query box at the bottom-centre.
 * Layout: tall rounded-rect, textarea top, footer row bottom.
 * Footer left: / (the response-shape MODE SELECTOR — typing "/" in an empty
 * input or clicking the button opens a menu of shapes the answer can take;
 * the pick pins a mode chip and forces that shape). Footer right: send.
 */

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { renderPlaintextFromRichText, stopEventPropagation, useEditor, useValue, type Editor, type TLRichText, type TLShape } from 'tldraw';
import { Slash, ArrowUp, Sparkles } from 'lucide-react';
import type { AnalyzeMode, AskShape } from '@jarwiz/shared';
import { inferMode, type ModeShape } from './inferMode';
import { ASKABLE, hasAskableContent } from './askable';
import { getShapeTitle } from '../shapes/shapeTitle';
import { useAsk } from './useAsk';
import { useCompose } from '../agents/useCompose';
import { useAnnotate } from '../agents/useAnnotate';
import { looksLikeBoard } from './boardIntent';
import { useAnalyze } from '../agents/useAnalyze';
import { gatherBoardCards } from '../agents/boardText';
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
import { isAutopilotRunning, subscribeAutopilot } from '../agents/autopilotStore';
import { cardSeedKey, ensureCardSeeds, ensureSeedPrompts, getSeedPrompts, subscribeSeed } from './seedPrompts';
import { getPromptFill, subscribePromptFill } from './promptFill';

const clip = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function shapeLabel(editor: Editor, shape: TLShape): string {
  // The primitive title (the tag above the selected card) IS the chip label.
  const title = getShapeTitle(shape).trim();
  if (title) return clip(title);
  const p = shape.props as Record<string, unknown>;
  let body = typeof p.text === 'string' ? p.text : '';
  if (!body && p.richText) { try { body = renderPlaintextFromRichText(editor, p.richText as TLRichText); } catch { /* ignore */ } }
  if (body.trim()) return clip(body.trim());
  const kind: Record<string, string> = { 'pdf-card': 'PDF', 'doc-card': 'Text', 'note-card': 'Note', 'table-card': 'Table', 'diagram-card': 'Diagram', 'prototype-card': 'Prototype', 'image-card': 'Image', 'link-card': 'Link', geo: 'Shape', text: 'Text', note: 'Note', frame: 'Section', arrow: 'Connector', group: 'Diagram' };
  return kind[shape.type] ?? 'Card';
}

/** The "/" mode menu — every shape an answer can take. Stickies appear here
 *  deliberately: the router never chooses them (they're the user's annotation
 *  medium), but an explicit pick is user intent. */
/** Response shapes for the "/" menu. 'board' is not a single-card AskShape —
 *  it fans the answer out into a set of cards (compose), handled specially.
 *  (`ModeShape` lives in ./inferMode so the type inferrer can share it.) */
const MODES: Array<{ shape: ModeShape; label: string; hint: string }> = [
  { shape: 'doc', label: 'Text', hint: 'a written card' },
  { shape: 'list', label: 'List', hint: 'bullets or a checklist' },
  { shape: 'table', label: 'Table', hint: 'rows × columns' },
  { shape: 'diagram', label: 'Diagram', hint: 'boxes and arrows' },
  { shape: 'prototype', label: 'Prototype', hint: 'a live UI, rendered' },
  { shape: 'affinity', label: 'Stickies', hint: 'notes across your cards' },
  { shape: 'board', label: 'Board', hint: 'a set of cards' },
];

export function PromptBar() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const { run: compose, phase: composePhase } = useCompose();
  const { run: annotate, phase: annotatePhase } = useAnnotate();
  const { analyze, runningMode } = useAnalyze();
  const [value, setValue] = useState('');
  // The "/" mode selector: a chosen response shape, pinned as a chip until the
  // ask is sent (or dismissed). `modeSource` tells us who pinned it — the user
  // (via "/" or explicit dismiss) or the live type-inferrer. 'user' is sticky:
  // once the user touches the choice we stop auto-inferring for this prompt.
  const [mode, setMode] = useState<ModeShape | null>(null);
  const [modeSource, setModeSource] = useState<'user' | 'auto' | null>(null);
  const [modeMenu, setModeMenu] = useState(false);
  const [modeIdx, setModeIdx] = useState(0);
  // Inline filtering, Claude-Code style: while the input reads "/que…", the
  // menu narrows to matching modes. Opened from the button, it shows all.
  const modeQuery = value.startsWith('/') ? value.slice(1).trim().toLowerCase() : '';
  const visibleModes = modeQuery
    ? MODES.filter((m) => m.label.toLowerCase().startsWith(modeQuery) || m.shape.startsWith(modeQuery))
    : MODES;
  const ground = useValue(
    'promptbar-ground',
    () => editor.getSelectedShapeIds()
      .map((id) => ({ id, shape: editor.getShape(id) }))
      // Content-gated: an empty card is the user's own scratch space, not
      // context — it gets no ground chip and contributes nothing to the ask.
      .filter((x) => x.shape && ASKABLE.has(x.shape.type) && hasAskableContent(editor, x.shape))
      .map((x) => ({ id: x.id, label: shapeLabel(editor, x.shape!) })),
    [editor],
  );
  const groundIds = ground.map((g) => g.id);
  const dropGround = (id: string) => {
    editor.setSelectedShapes(editor.getSelectedShapeIds().filter((x) => x !== id));
  };
  // Gate the board-scan chips on SUBSTANCE, not shape count: the same
  // collector the scans run on must find enough contentful cards — three
  // empty cards, a couple of arrows, or a lone sticky summon nothing.
  const meaningfulCount = useValue('promptbar-meaningful', () => gatherBoardCards(editor).length, [editor]);
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
          : s.type === 'prototype-card'
            ? str(p.html)
            : str(p.text);
    const title = getShapeTitle(s).trim();
    return { id: s.id, type: s.type, seedKey: cardSeedKey(s.id, text, title), pdf: false as const, text, title };
  }, [editor]);
  // While Jarwiz holds the pen on the selected card (a streaming ask/regen or
  // an autopilot fill), the pills hide — firing another instruction mid-write
  // would contradict the one in flight (owner call, 2026-07-05).
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const soleWriting = useSyncExternalStore(
    subscribeAutopilot,
    () => (sole && !sole.pdf ? isAutopilotRunning(sole.id) : false),
    () => false,
  );
  const soleBusy = Boolean(sole && !sole.pdf && (streamingSet.has(sole.id) || soleWriting));
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

  // A comment's "let Jarwiz fix it" (and any future affordance) hands a
  // ready-made prompt to the bar: drop it in, ground it on its card, focus —
  // the user reviews and hits Enter. We prefill, never auto-send.
  const fill = useSyncExternalStore(subscribePromptFill, getPromptFill, getPromptFill);
  useEffect(() => {
    if (!fill) return;
    if (fill.groundId && editor.getShape(fill.groundId)) editor.select(fill.groundId);
    setValue(fill.text);
    setMode(null);
    setModeSource(null);
    requestAnimationFrame(() => {
      const ta = document.querySelector<HTMLTextAreaElement>('.jz-promptbar-input');
      ta?.focus();
      ta?.setSelectionRange(fill.text.length, fill.text.length);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill?.nonce]);

  // ── Smart type inference (spike) ────────────────────────────────────────
  // As the user types a *create-from-scratch* prompt, guess the answer's shape
  // and auto-pin the mode chip. Gated to when nothing is grounded (grounding =
  // "ask about the selection", a different intent) and to when the user hasn't
  // taken the choice into their own hands. Debounced so it settles a beat after
  // the keystrokes, not on every one — the chip should feel considered.
  useEffect(() => {
    if (modeSource === 'user') return; // user owns the choice now — hands off.
    if (groundIds.length > 0) {
      // Selection present → this is a refinement, not a fresh create. Retract
      // any auto guess so it can't force a shape onto the selection's answer.
      if (modeSource === 'auto') { setMode(null); setModeSource(null); }
      return;
    }
    const t = setTimeout(() => {
      const guess = inferMode(value);
      if (guess) {
        setMode((m) => (m === guess.shape ? m : guess.shape));
        setModeSource('auto');
      } else if (modeSource === 'auto') {
        setMode(null);
        setModeSource(null);
      }
    }, 220); // ≈ --jz-dur-base: land just after the typing settles.
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, groundIds.length, modeSource]);

  const pickMode = (shape: ModeShape) => {
    setMode(shape);
    setModeSource('user'); // an explicit pick — stop inferring for this prompt.
    setModeMenu(false);
    setModeIdx(0);
    // Swallow the "/query" that summoned the menu — it was a command, not prose.
    setValue((v) => (v.startsWith('/') ? '' : v));
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.jz-promptbar-input')?.focus());
  };

  const composing = composePhase === 'planning' || composePhase === 'building';
  const annotating = annotatePhase === 'thinking';
  const submit = () => {
    const q = value.trim();
    if (!q || isAsking || composing || annotating) return;
    // Route by intent:
    //  - Board (explicit "/" Board or inferred) → fan out into a set of cards.
    //  - Stickies (explicit "/" Stickies) → drop a note across each relevant card.
    //  - else → a single-card ask, shape optionally forced by the "/" mode.
    if (mode === 'board' || (!mode && looksLikeBoard(q))) {
      void compose(q);
    } else if (mode === 'affinity') {
      void annotate(q);
    } else if (!mode && sole && !sole.pdf && sole.type === 'prototype-card') {
      // Selecting a prototype and typing an instruction regenerates it in place
      // (the card IS the prototype) — not a new card beside it.
      void ask(q, [sole.id], { targetId: sole.id, forceShape: 'prototype', skipClarify: true });
    } else {
      void ask(q, groundIds, mode ? { forceShape: mode as AskShape } : undefined);
    }
    setValue('');
    setMode(null); // the mode applies to one ask, like the text it rode with
    setModeSource(null);
  };
  const runTool = (mode: AnalyzeMode) => { void analyze(mode); };
  // While the sole card is being EDITED, a pill is an offer for Jarwiz to
  // take over THIS card — clicking runs the ask straight into it (in-place),
  // no prompt-bar detour. Doc cards only: the in-place table regen path
  // corrupts the grid (appends cells mid-row, then stalls — found in the
  // 2026-07-05 pill dogfood); until that's fixed, table/diagram pills keep
  // the safe new-card path.
  const editingSole = useValue(
    'promptbar-editing-sole',
    () => {
      const editing = editor.getEditingShapeId();
      if (!editing) return null;
      return editor.getShape(editing)?.type === 'doc-card' ? editing : null;
    },
    [editor],
  );
  const useStarter = (q: string) => {
    if (editingSole) {
      // Hand off in READ mode: edit mode shows raw markdown and its height
      // only ratchets up (the "long empty card" bug) — read mode renders the
      // stream and fit-height can shrink the card to the final content.
      editor.setEditingShape(null);
      editor.select(editingSole);
      void ask(q, [editingSole], { targetId: editingSole, skipClarify: true });
      return;
    }
    setValue(q);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.jz-promptbar-input')?.focus());
  };

  const placeholder = groundIds.length ? 'Ask about the selection…' : 'What would you like to change or create?';
  const busyLabel = runningMode ? (runningMode === 'tensions' ? 'Scanning…' : runningMode === 'gaps' ? 'Reviewing…' : 'Critiquing…') : null;

  // Board-scan chips need enough substance to find gaps/tensions across cards.
  // Two contentful cards already qualify — a brief plus one generated artifact
  // is exactly when "what am I missing" earns its place (dogfood 2026-07-05;
  // the old ≥3 hid it right after the first table landed).
  const showChips = !runningMode && groundIds.length === 0 && meaningfulCount >= 2;
  // Pills are ALWAYS contextual — generated from the card's own content.
  // Nothing scripted: until the tailored pills arrive (or if the card is
  // empty) we show nothing. Predictable operations live on the card's
  // floating bar (Refine), not here.
  const starters: Array<{ label: string; prompt: string }> =
    groundIds.length === 1 && (seeds?.length ?? 0) > 0
      ? seeds!.map((s) => ({ label: s.label, prompt: s.prompt }))
      : [];
  const showStarters = !runningMode && !isAsking && !soleBusy && !value.trim() && starters.length > 0;
  // The 5-20s quiet gap while tailored pills are being generated (cache still
  // undefined = fetch in flight): show shimmering placeholder pills so the
  // wait reads as "thinking", not "nothing here" (feel pass, ROADMAP §10 #4).
  const showSeedWait =
    !runningMode && !isAsking && !soleBusy && !value.trim() && groundIds.length === 1 && Boolean(sole) && seeds === undefined;

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
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            setModeIdx(0);
            // A leading "/" is a command: open the menu and filter it live as
            // the user types (a "/" mid-sentence is just a character).
            if (next.startsWith('/')) setModeMenu(true);
            else if (modeMenu) setModeMenu(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (modeMenu) {
              // Number keys quick-pick; arrows walk; Enter takes the highlight.
              const n = Number(e.key);
              if (Number.isInteger(n) && n >= 1 && n <= visibleModes.length) {
                e.preventDefault();
                pickMode(visibleModes[n - 1]!.shape);
                return;
              }
              if (e.key === 'ArrowDown') { e.preventDefault(); setModeIdx((i) => Math.min(i + 1, visibleModes.length - 1)); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setModeIdx((i) => Math.max(i - 1, 0)); return; }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                if (visibleModes[modeIdx]) pickMode(visibleModes[modeIdx]!.shape);
                return;
              }
              if (e.key === 'Escape') { setModeMenu(false); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
          }}
        />

        {modeMenu ? (
          <div className="jz-mode-menu" role="menu" aria-label="Answer shape">
            <span className="jz-mode-menu-title">Answer as…</span>
            {visibleModes.length === 0 ? (
              <span className="jz-mode-item-hint" style={{ padding: '6px 8px' }}>No matching shape</span>
            ) : (
              visibleModes.map((m, i) => (
                <button
                  key={m.shape}
                  className={`jz-mode-item${i === modeIdx ? ' jz-mode-item--active' : ''}`}
                  role="menuitem"
                  onMouseEnter={() => setModeIdx(i)}
                  onClick={() => pickMode(m.shape)}
                >
                  <span className="jz-mode-item-num" aria-hidden>{i + 1}</span>
                  <span className="jz-mode-item-label">{m.label}</span>
                  <span className="jz-mode-item-hint">{m.hint}</span>
                </button>
              ))
            )}
          </div>
        ) : null}

        <div className="jz-promptbar-footer">
          <div className="jz-promptbar-footer-left">
            {/* The / button IS the mode selector; once a shape is picked the
                chip takes its place (dismiss to hand the choice back to the
                model). Same menu as typing "/" in the input. */}
            {mode ? (
              <span
                key={`${mode}-${modeSource}`}
                className={`jz-pb-ground jz-pb-mode${modeSource === 'auto' ? ' jz-pb-mode--auto' : ''}`}
                title={modeSource === 'auto' ? 'Auto-detected answer shape — dismiss to let Jarwiz decide' : 'Answer shape — picked with /'}
              >
                {modeSource === 'auto' ? <Sparkles className="jz-pb-mode-spark" size={11} strokeWidth={2} aria-hidden /> : null}
                {MODES.find((m) => m.shape === mode)?.label ?? mode}
                <button
                  className="jz-pb-ground-x"
                  aria-label="Clear answer shape (the model decides)"
                  onClick={() => { setMode(null); setModeSource('user'); }}
                >✕</button>
              </span>
            ) : (
              <button
                className={`jz-promptbar-icon-btn${modeMenu ? ' jz-promptbar-icon-btn--active' : ''}`}
                title="Answer shape (/)"
                aria-label="Choose the answer's shape"
                onClick={() => setModeMenu((v) => !v)}
              >
                <Slash size={16} strokeWidth={1.8} />
              </button>
            )}
          </div>
          <button
            className="jz-promptbar-send"
            disabled={!value.trim() || isAsking || composing || annotating}
            onClick={submit}
            title="Send (Enter)"
          >
            {composing ? (
              <span className="jz-promptbar-busy-inline">{composePhase === 'planning' ? 'Planning…' : 'Building…'}</span>
            ) : annotating ? (
              <span className="jz-promptbar-busy-inline">Noting…</span>
            ) : busyLabel ? (
              <span className="jz-promptbar-busy-inline">{busyLabel}</span>
            ) : (
              <ArrowUp size={16} strokeWidth={2.2} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
