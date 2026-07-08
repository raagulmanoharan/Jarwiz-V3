/**
 * The canvas prompt bar — persistent query box at the bottom-centre.
 * Layout: tall rounded-rect, textarea top, footer row bottom.
 * Footer left: / (the response-shape MODE SELECTOR — typing "/" in an empty
 * input or clicking the button opens a menu of shapes the answer can take;
 * the pick pins a mode chip and forces that shape). Footer right: send.
 */

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { renderPlaintextFromRichText, stopEventPropagation, useEditor, useValue, type Editor, type TLRichText, type TLShape, type TLShapeId } from 'tldraw';
import { Slash, ArrowUp, Sparkles, FileText, Link2, ClipboardList } from 'lucide-react';
import type { AnalyzeMode, AskShape } from '@jarwiz/shared';
import { type ModeShape } from './modeShape';
import { suggestShape } from './suggestShape';
import { ASKABLE, hasAskableContent } from './askable';
import { getShapeTitle } from '../shapes/shapeTitle';
import { useAsk } from './useAsk';
import { useCompose } from '../agents/useCompose';
import { useAnnotate } from '../agents/useAnnotate';
import { classifyRefineIntent, INLINE_EDITABLE, REFINE_SHAPE } from './refineIntent';
import { useAnalyze } from '../agents/useAnalyze';
import { gatherBoardCards } from '../agents/boardText';
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
import { isAutopilotRunning, subscribeAutopilot } from '../agents/autopilotStore';
import { cardSeedKey, ensureCardSeeds, ensureSeedPrompts, getSeedPrompts, subscribeSeed } from './seedPrompts';
import { getPromptFill, subscribePromptFill } from './promptFill';
import { getActiveBoard, markBoardUsed, subscribeBoards } from '../boards/boardStore';
import { isDemo, isEmbed, isUseCases } from '../boards/demo';
import { setOnboarding, setOnboardingEngaged } from './onboardingStore';
import { hasIngestibleFile, ingestFiles } from '../ingest/registerIngestion';

// Intent-first onboarding: on a brand-new empty board the composer rises to the
// centre with a heading and a few starter prompts, then glides down into its
// dock as the first answer builds. Full example prompts so a first-timer sees
// what a good ask looks like (and can send or edit).
// Short labels so the chips sit in one horizontal row; tapping fills the fuller
// prompt into the composer (editable before send).
const INTRO_STARTERS: Array<{ label: string; prompt: string }> = [
  { label: 'Compare a few tools', prompt: 'Compare Notion, Linear and Asana for a small team' },
  { label: 'Brainstorm a feature', prompt: 'Brainstorm features for a habit-tracking app' },
  { label: 'Break down a plan', prompt: 'Break down a launch plan for a new product' },
];

// The empty intent composer types these on its own and previews the shape it'd
// build a few words in — the box is alive, and Jarwiz shows it understood
// before you commit. Shapes are real ModeShape values so the preview chip reuses
// the composer's own suggestion chip.
const INTRO_ANIM: Array<{ text: string; shape: ModeShape }> = [
  { text: 'Compare Notion, Linear and Asana for a small team', shape: 'table' },
  { text: 'Brainstorm features for a habit-tracking app', shape: 'board' },
  { text: 'Map the onboarding flow end to end', shape: 'diagram' },
  { text: 'Turn my Q2 numbers into a dashboard', shape: 'dashboard' },
];
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
// Doc/Text is deliberately ABSENT: it's the implicit default — typing with no
// mode selected always answers as a doc. The selector only lists the shapes you
// must explicitly opt into to get something OTHER than a doc (owner call
// 2026-07-07).
const MODES: Array<{ shape: ModeShape; label: string; hint: string }> = [
  { shape: 'list', label: 'List', hint: 'bullets or a checklist' },
  { shape: 'table', label: 'Table', hint: 'rows × columns' },
  { shape: 'diagram', label: 'Diagram', hint: 'boxes and arrows' },
  { shape: 'prototype', label: 'Prototype', hint: 'a live UI, rendered' },
  { shape: 'dashboard', label: 'Dashboard', hint: 'KPIs, charts, a table' },
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
  // The "/" mode selector: an explicitly chosen response shape, pinned as a
  // chip until the ask is sent (or the chip dismissed).
  const [mode, setMode] = useState<ModeShape | null>(null);
  // Who pinned the mode chip: the user (via "/" or a manual pick/dismiss) or the
  // live shape suggester. 'user' is sticky — once the user owns the choice we
  // stop auto-suggesting for this prompt so we never fight their pick.
  const [modeSource, setModeSource] = useState<'user' | 'auto' | null>(null);
  const [modeMenu, setModeMenu] = useState(false);
  const [modeIdx, setModeIdx] = useState(0);
  // A file dragged over the composer to attach it as context (drop-to-attach).
  const [dragActive, setDragActive] = useState(false);

  // ── Intent-first onboarding (a brand-new, empty board) ────────────────────
  const board = useSyncExternalStore(subscribeBoards, getActiveBoard, getActiveBoard);
  const boardEmpty = useValue('promptbar-board-empty', () => editor.getCurrentPageShapeIds().size === 0, [editor]);
  // Let tldraw hydrate from IndexedDB before trusting emptiness, so a returning
  // board that loads async never flashes the intro for a frame.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(false);
    const t = setTimeout(() => setHydrated(true), 400);
    return () => clearTimeout(t);
  }, [board?.id]);
  // `leaving` keeps the intro mounted through the glide-down so the composer
  // reads as one object travelling to its dock, not a hard cut.
  const [leaving, setLeaving] = useState(false);
  const introMode =
    Boolean(board?.isNew) && boardEmpty && hydrated && !leaving && !isDemo() && !isEmbed() && !isUseCases();
  const introMounted = introMode || leaving;
  // If the board gains a shape another way (a dropped PDF), retire the intro.
  useEffect(() => {
    if (!boardEmpty && board?.isNew) markBoardUsed(board.id);
  }, [boardEmpty, board]);
  // Tell the rest of the chrome (tool rail, parked cursor) to step aside while
  // the intent screen is up, and slide back in as the board opens.
  useEffect(() => {
    setOnboarding(introMode);
    return () => setOnboarding(false);
  }, [introMode]);
  // Retire the intro on the first ask: clear isNew (so it never re-arms) and
  // hold the block for the glide, then unmount.
  const leaveIntro = () => {
    if (!board?.isNew) return;
    markBoardUsed(board.id);
    setLeaving(true);
    setTimeout(() => setLeaving(false), 650);
  };
  // The empty intent composer types example intents on its own and previews the
  // shape a few words in, so the box is alive and the intelligence shows before
  // you commit. Purely a placeholder animation — it never touches the real value
  // or mode, and it stops the moment you focus or type.
  const [focused, setFocused] = useState(false);
  const [introPh, setIntroPh] = useState('');
  const [introShape, setIntroShape] = useState<ModeShape | null>(null);
  const introAnim = introMode && !value.trim() && !focused && !prefersReducedMotion();
  // The ambient scene stays alive until you actually reach for the composer —
  // focusing or typing hushes it the moment you engage, before the first send.
  const introEngaged = introMode && (focused || Boolean(value.trim()));
  useEffect(() => {
    setOnboardingEngaged(introEngaged);
    return () => setOnboardingEngaged(false);
  }, [introEngaged]);
  useEffect(() => {
    if (!introAnim) { setIntroPh(''); setIntroShape(null); return; }
    let alive = true;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((res) => { timers.push(window.setTimeout(res, ms) as unknown as number); });
    void (async () => {
      let i = 0;
      while (alive) {
        const ex = INTRO_ANIM[i % INTRO_ANIM.length]!;
        setIntroShape(null);
        const reveal = Math.min(14, Math.max(6, Math.floor(ex.text.length * 0.4)));
        for (let c = 1; c <= ex.text.length && alive; c++) {
          setIntroPh(`${ex.text.slice(0, c)} ▏`);
          if (c === reveal) setIntroShape(ex.shape);
          await wait(38);
        }
        if (!alive) break;
        setIntroPh(`${ex.text} ▏`);
        await wait(1900);
        for (let c = ex.text.length; c >= 0 && alive; c--) {
          setIntroPh(c > 0 ? `${ex.text.slice(0, c)} ▏` : '');
          if (c < 8) setIntroShape(null);
          await wait(16);
        }
        await wait(450);
        i += 1;
      }
    })();
    return () => { alive = false; timers.forEach((t) => window.clearTimeout(t)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introAnim]);
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
  // Just-attached files whose upload is still running: shown as an
  // "attaching…" pill so the composer reacts instantly, then it becomes a real
  // context pill (above) the moment the card is readable.
  const attaching = useValue(
    'promptbar-attaching',
    () =>
      editor
        .getSelectedShapeIds()
        .map((id) => editor.getShape(id))
        .filter((s): s is TLShape => Boolean(s) && (s!.type === 'pdf-card' || s!.type === 'sheet-card') && (s!.props as { status?: string }).status === 'uploading')
        .map((s) => ({ id: s.id, label: ((s.props as { name?: string }).name || 'File').replace(/\.[^.]+$/, '') })),
    [editor],
  );
  // Attach files dropped or pasted straight onto the composer: create the
  // source card(s) and select them, so they surface as context pills right
  // here (adding content also opens the board out of onboarding).
  const attachFiles = (files: FileList | File[]) => {
    if (!hasIngestibleFile(files)) return;
    void ingestFiles(editor, Array.from(files));
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

  // ── Smart shape suggestion ────────────────────────────────────────────────
  // As the user types a from-scratch prompt, ask the model which shape fits and
  // pre-pin the "/" chip (they can change or dismiss it — the shape stays
  // explicit). Model-inferred, not keyword-matched. Gated to UNGROUNDED prompts
  // (a selection means "edit vs new", a different path) and backs off the moment
  // the user owns the choice. Debounced so it settles a beat after typing and a
  // stale in-flight guess can't overwrite a newer one (AbortController).
  useEffect(() => {
    if (modeSource === 'user') return; // user owns the choice — hands off.
    if (groundIds.length > 0) {
      if (modeSource === 'auto') { setMode(null); setModeSource(null); }
      return;
    }
    if (value.trim().length < 4 || value.startsWith('/')) {
      if (modeSource === 'auto') { setMode(null); setModeSource(null); }
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      void suggestShape(value, ac.signal).then((guess) => {
        if (ac.signal.aborted) return;
        if (guess) {
          setMode((m) => (m === guess ? m : guess));
          setModeSource('auto');
        } else {
          // Model sees no clear non-doc shape → clear any prior auto guess.
          setModeSource((src) => (src === 'auto' ? (setMode(null), null) : src));
        }
      });
    }, 500); // let the typing settle before spending a model call
    return () => { ac.abort(); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, groundIds.length, modeSource]);

  const pickMode = (shape: ModeShape) => {
    setMode(shape);
    setModeSource('user'); // an explicit pick — stop suggesting for this prompt.
    setModeMenu(false);
    setModeIdx(0);
    // Swallow the "/query" that summoned the menu — it was a command, not prose.
    setValue((v) => (v.startsWith('/') ? '' : v));
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.jz-promptbar-input')?.focus());
  };

  const composing = composePhase === 'planning' || composePhase === 'building';
  const annotating = annotatePhase === 'thinking';
  // A single artifact card is selected and the user typed with no mode. Ask the
  // model whether the instruction EDITS that card in place or makes a NEW card
  // from it, then dispatch: an edit regenerates the same card (keeping its
  // shape); a new request lands a fresh doc grounded on the selection.
  const routeSelectedAsk = async (q: string, id: TLShapeId, cardType: string) => {
    const intent = await classifyRefineIntent(q, cardType);
    if (intent === 'edit') {
      void ask(q, [id], { targetId: id, forceShape: REFINE_SHAPE[cardType], skipClarify: true });
    } else {
      void ask(q, [id], { forceShape: 'doc' });
    }
  };

  const submit = () => {
    const q = value.trim();
    if (!q || isAsking || composing || annotating) return;
    // Onboarding: the first ask sends the composer gliding down into its dock.
    if (introMode) leaveIntro();
    // SHAPE is explicit only — no implicit routing from the prompt text. With no
    // mode selected the answer is always a DOC (the composer's first-class
    // default); Board / Stickies / any other shape require picking the "/" mode
    // (owner call 2026-07-07). Whether a typed instruction EDITS a selected card
    // in place vs makes a new card is inferred from intent (see routeSelectedAsk).
    if (mode === 'board') {
      void compose(q);
    } else if (mode === 'affinity') {
      void annotate(q);
    } else if (!mode && sole && !sole.pdf && INLINE_EDITABLE.has(sole.type)) {
      // A single artifact card is selected and no mode chosen → let intent decide
      // edit-in-place vs a new doc (async classify), then dispatch.
      void routeSelectedAsk(q, sole.id, sole.type);
    } else {
      void ask(q, groundIds, { forceShape: (mode as AskShape) ?? 'doc' });
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
    <div className={`jz-promptbar-dock${introMode ? ' jz-promptbar-dock--intro' : ''}`} onPointerDown={stopEventPropagation}>
      {/* Intent-first onboarding: heading + starter prompts above the centred
          composer, which glides down to its dock as the first answer builds. */}
      {introMounted ? (
        <div className={`jz-pb-intro${introMode ? '' : ' jz-pb-intro--leaving'}`}>
          <span className="jz-pb-intro-spark" aria-hidden>✦</span>
          <h1 className="jz-pb-intro-head">What are we figuring out?</h1>
          <p className="jz-pb-intro-sub">Drop in an idea, a document, or your notes. I’ll lay it out as a board you can shape.</p>
          <div className="jz-pb-intro-chips">
            {INTRO_STARTERS.map((s) => (
              <button key={s.label} className="jz-pb-intro-chip" onClick={() => useStarter(s.prompt)} title="Use this prompt (editable)">{s.label}</button>
            ))}
          </div>
        </div>
      ) : null}
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

      <div
        className={`jz-promptbar${dragActive ? ' jz-promptbar--drag' : ''}`}
        style={{ '--pb-max': '560px' } as CSSProperties}
        onDragOver={(e) => {
          // Only claim the drop if it actually carries a file we can attach.
          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (!dragActive) setDragActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragActive(false);
        }}
        onDrop={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
          attachFiles(e.dataTransfer.files);
        }}
      >
        {ground.length > 0 || attaching.length > 0 ? (
          <div className="jz-pb-grounds">
            {ground.slice(0, 3).map((g) => (
              <span key={g.id} className="jz-pb-ground" title={g.label}>
                {g.label}
                <button className="jz-pb-ground-x" aria-label="Remove from context" onClick={() => dropGround(g.id)}>✕</button>
              </span>
            ))}
            {ground.length > 3 ? <span className="jz-pb-ground jz-pb-ground--more">+{ground.length - 3}</span> : null}
            {attaching.map((a) => (
              <span key={a.id} className="jz-pb-ground jz-pb-ground--attaching" title={`${a.label} · attaching…`}>
                <span className="jz-pb-ground-spin" aria-hidden />
                {a.label}
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          className="jz-promptbar-input"
          value={value}
          rows={2}
          placeholder={introAnim && introPh ? introPh : placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPaste={(e) => {
            // A pasted file (a screenshot, a PDF) attaches as context; pasted
            // text falls through to the input as the prompt.
            const files = Array.from(e.clipboardData.files);
            if (files.length && hasIngestibleFile(files)) { e.preventDefault(); attachFiles(files); }
          }}
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
                title={modeSource === 'auto' ? 'Suggested answer shape — change it with / or dismiss to write a doc' : 'Answer shape — picked with /'}
              >
                {modeSource === 'auto' ? <Sparkles className="jz-pb-mode-spark" size={11} strokeWidth={2} aria-hidden /> : null}
                {MODES.find((m) => m.shape === mode)?.label ?? mode}
                <button
                  className="jz-pb-ground-x"
                  aria-label="Clear answer shape (write a doc)"
                  onClick={() => { setMode(null); setModeSource('user'); }}
                >✕</button>
              </span>
            ) : introMode ? (
              // Onboarding: no "/" (Jarwiz suggests the shape for you). While the
              // composer types its own examples, preview the shape it would build.
              introAnim && introShape ? (
                <span className="jz-pb-ground jz-pb-mode jz-pb-mode--auto" aria-hidden>
                  <Sparkles className="jz-pb-mode-spark" size={11} strokeWidth={2} />
                  {MODES.find((m) => m.shape === introShape)?.label ?? introShape}
                </span>
              ) : null
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

      {/* Onboarding on-ramps: bringing your own content is as inviting as
          typing. Calm hints — the canvas already accepts drops and the composer
          accepts pastes, so these communicate rather than gate. */}
      {introMounted ? (
        <div className={`jz-pb-onramp${introMode ? '' : ' jz-pb-onramp--leaving'}`} aria-hidden>
          <span className="jz-pb-onramp-or">or</span>
          <span className="jz-pb-onramp-item"><FileText size={13} strokeWidth={1.9} /> drop a PDF</span>
          <span className="jz-pb-onramp-item"><Link2 size={13} strokeWidth={1.9} /> paste a link</span>
          <span className="jz-pb-onramp-item"><ClipboardList size={13} strokeWidth={1.9} /> paste a transcript</span>
        </div>
      ) : null}
    </div>
  );
}
