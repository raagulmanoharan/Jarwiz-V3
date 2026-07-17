/**
 * The canvas prompt bar — persistent query box at the bottom-centre.
 * Layout: tall rounded-rect, textarea top, footer row bottom.
 * Footer left: / (the response-shape MODE SELECTOR — typing "/" in an empty
 * input or clicking the button opens a menu of shapes the answer can take;
 * the pick pins a mode chip and forces that shape). Footer right: send.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { renderPlaintextFromRichText, stopEventPropagation, useEditor, useValue, type Editor, type TLRichText, type TLShape, type TLShapeId } from 'tldraw';
import { Slash, ArrowUp, FileText, Link2, ClipboardList, Paperclip } from 'lucide-react';
import { JarwizSpark } from '../ui/JarwizSpark';
import type { AnalyzeMode, AskShape } from '@jarwiz/shared';
import { type ModeShape } from './modeShape';
import { suggestShape } from './suggestShape';
import { ASKABLE, hasAskableContent } from './askable';
import { getShapeTitle } from '../shapes/shapeTitle';
import { useAsk } from './useAsk';
import { useCompose } from '../agents/useCompose';
import { useAnnotate } from '../agents/useAnnotate';
import { classifyRefineIntent, resolveMentionTarget, INLINE_EDITABLE, REFINE_SHAPE } from './refineIntent';
import { useAnalyze } from '../agents/useAnalyze';
import { gatherBoardCards } from '../agents/boardText';
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
import { clearAgentError, getAgentError, subscribeAgentError } from '../agents/agentError';
import { isAutopilotRunning, subscribeAutopilot } from '../agents/autopilotStore';
import { cardSeedKey, ensureCardSeeds, ensureSeedPrompts, getSeedPrompts, subscribeSeed } from './seedPrompts';
import { getPromptFill, subscribePromptFill } from './promptFill';
import { getDraft, subscribeDraft } from './draft';
import { getActiveBoard, markBoardUsed, subscribeBoards } from '../boards/boardStore';
import { isDemo, isEmbed, isUseCases } from '../boards/demo';
import { DEMO_NOTICE, getBackendSnapshot, subscribeBackend, PLAYGROUND_NOTICE } from '../lib/backend';
import { openSidePanel } from '../ui/sidePanelStore';
import { setOnboarding, setOnboardingEngaged } from './onboardingStore';
import { hasIngestibleFile } from '../ingest/registerIngestion';
import { classifyFile, isAttachableText, looksLikeTranscript, makeTextAttachment, materializeAttachment, uploadAttachment, type Attachment } from '../ingest/attachments';
import { useDebrief } from '../agents/useDebrief';
import { getPersona, subscribePersona, type Persona } from '../onboarding/personaStore';
import { MentionInput, type MentionCard, type MentionInputHandle, type MentionModel } from './MentionInput';

// Intent-first onboarding: on a brand-new empty board the composer rises to the
// centre with a heading and a few starter prompts, then glides down into its
// dock as the first answer builds. Full example prompts so a first-timer sees
// what a good ask looks like (and can send or edit).
// Short labels so the chips sit in one horizontal row; tapping fills the fuller
// prompt into the composer (editable before send).
//
// The starters and self-typing examples are keyed on WHO is here — the
// ask-once persona modal's pick (personaStore). `null` = generic/exploring.
const INTRO_STARTERS: Record<Persona | 'default', Array<{ label: string; prompt: string }>> = {
  default: [
    { label: 'Compare a few tools', prompt: 'Compare Notion, Linear and Asana for a small team' },
    { label: 'Brainstorm a feature', prompt: 'Brainstorm features for a habit-tracking app' },
    { label: 'Break down a plan', prompt: 'Break down a launch plan for a new product' },
  ],
  product: [
    { label: 'Break down a launch', prompt: 'Break down a launch plan for a new product' },
    { label: 'Brainstorm a feature', prompt: 'Brainstorm features for a habit-tracking app' },
    { label: 'Compare a few tools', prompt: 'Compare Notion, Linear and Asana for a small team' },
  ],
  research: [
    { label: 'Map a topic', prompt: 'Map the research landscape around habit formation' },
    { label: 'Compare findings', prompt: 'Compare the main studies on remote work productivity in a table' },
    { label: 'Digest a long read', prompt: 'Summarize the key arguments of a long report into one page' },
  ],
  design: [
    { label: 'Map a user flow', prompt: 'Map the onboarding flow for a mobile app end to end' },
    { label: 'Prototype an idea', prompt: 'Prototype a focus-timer app I can click through' },
    { label: 'Explore concepts', prompt: 'Brainstorm three directions for a pricing page' },
  ],
  trip: [
    { label: 'Plan an itinerary', prompt: 'Plan a five-day Tokyo itinerary as a day-by-day board' },
    { label: 'Compare stays', prompt: 'Compare three Lisbon neighbourhoods for a week-long stay' },
    { label: 'Pack smart', prompt: 'Build a packing checklist for two weeks of mixed weather' },
  ],
  talk: [
    { label: 'Outline a talk', prompt: 'Outline a 20-minute conference talk on design systems' },
    { label: 'Storyboard slides', prompt: 'Storyboard the slide flow for a product demo' },
    { label: 'Sharpen the message', prompt: 'Distill my talk notes into three memorable takeaways' },
  ],
  decide: [
    { label: 'Compare options', prompt: 'Compare three laptops for video editing in a table' },
    { label: 'Weigh a big call', prompt: 'Lay out the pros and cons of relocating to Berlin' },
    { label: 'Find the blind spots', prompt: 'What am I missing before signing a two-year lease?' },
  ],
};

// The intent screen speaks the visitor's language the moment they answer
// "What brings you here?" — the hero question and its sub-line re-theme with
// the pick (before any pick, `null` reads the default pair).
const INTRO_HEAD: Record<Persona | 'default', string> = {
  default: 'What are we figuring out?',
  product: 'What are we building?',
  research: 'What are we digging into?',
  design: 'What are we designing?',
  trip: 'Where are we off to?',
  talk: 'What’s your talk about?',
  decide: 'What are we deciding?',
};
const INTRO_SUB: Record<Persona | 'default', string> = {
  default: 'Drop in an idea, a document, or your notes. I’ll lay it out as a board you can shape.',
  product: 'Drop in an idea, a PRD, or your notes. I’ll lay it out as a board you can shape.',
  research: 'Drop in a paper, a link, or a question. I’ll lay it out as a map you can explore.',
  design: 'Drop in a flow, a screenshot, or crit notes. I’ll lay it out as a board you can shape.',
  trip: 'Drop in links, dates, or half a plan. I’ll lay it out as a day-by-day board.',
  talk: 'Drop in your notes or a rough outline. I’ll lay it out as a storyboard you can shape.',
  decide: 'Drop in the options and what matters. I’ll lay it out so the answer shows itself.',
};

// The empty intent composer types these on its own — the box is alive, so
// Jarwiz shows it's listening before you commit. Per-persona, same reason as
// the starters. (No shape preview: the typed example carries the intent on its
// own; the pill was removed as noise — owner call, 2026-07-12.)
const INTRO_ANIM: Record<Persona | 'default', string[]> = {
  default: [
    'Compare Notion, Linear and Asana for a small team',
    'Brainstorm features for a habit-tracking app',
    'Map the onboarding flow end to end',
    'Turn my Q2 numbers into a dashboard',
  ],
  product: [
    'Break down a launch plan for a new product',
    'Compare Notion, Linear and Asana for a small team',
    'Map the signup flow end to end',
    'Turn my Q2 numbers into a dashboard',
  ],
  research: [
    'Compare the main studies on remote work',
    'Map the literature around habit formation',
    'Cluster my reading notes by theme',
    'Turn these survey results into a dashboard',
  ],
  design: [
    'Map the onboarding flow end to end',
    'Prototype a focus-timer app',
    'Compare three pricing-page layouts',
    'Turn my research notes into personas',
  ],
  trip: [
    'Plan a five-day Tokyo itinerary',
    'Compare three neighbourhoods to stay in',
    'Map the route between the stops',
    'Build a packing checklist',
  ],
  talk: [
    'Outline a 20-minute talk on design systems',
    'Storyboard the slide flow',
    'Diagram the narrative arc',
    'Compare three opening hooks',
  ],
  decide: [
    'Compare three laptops for video editing',
    'Lay out the pros and cons of relocating',
    'Map the decision and its trade-offs',
    'Turn my criteria into a scorecard',
  ],
};
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clip = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Friendly noun for a shape kind — the muted right column of the "@" picker,
// so a card with no title still reads as "PDF" / "Table" / "Note".
const KIND_NOUN: Record<string, string> = {
  'pdf-card': 'PDF', 'doc-card': 'Text', 'note-card': 'Note', 'table-card': 'Table',
  'diagram-card': 'Diagram', 'prototype-card': 'Prototype', 'dashboard-card': 'Dashboard',
  'map-card': 'Map', 'image-card': 'Image', 'link-card': 'Link', 'youtube-card': 'Video',
  'sheet-card': 'Sheet', geo: 'Shape', text: 'Text', note: 'Note', frame: 'Section',
  arrow: 'Connector', group: 'Diagram',
};
const cardKindNoun = (type: string) => KIND_NOUN[type] ?? 'Card';

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
  { shape: 'map', label: 'Map', hint: 'pins & a route' },
  { shape: 'affinity', label: 'Stickies', hint: 'notes across your cards' },
  { shape: 'board', label: 'Board', hint: 'a set of cards' },
  { shape: 'debrief', label: 'Debrief', hint: 'decisions · actions · risks' },
];

export function PromptBar() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const { run: compose, phase: composePhase } = useCompose();
  const { run: debrief, phase: debriefPhase } = useDebrief();
  const { run: annotate, phase: annotatePhase } = useAnnotate();
  const { analyze, runningMode } = useAnalyze();
  // The composer is a mention-aware contenteditable (MentionInput). Its model:
  //  - plainText: prose only (mentions excluded) — the "/" command, the shape
  //    suggester, and the "is there anything to send" gate all read this.
  //  - promptText: prose with each mention rendered as its label — what we send.
  //  - domMentions: the referenced card ids, in order. THESE ARE THE GROUNDS.
  const inputRef = useRef<MentionInputHandle>(null);
  const [plainText, setPlainText] = useState('');
  const [promptText, setPromptText] = useState('');
  const [domMentions, setDomMentions] = useState<string[]>([]);
  // Cards referenced by TYPING "@" (not by canvas selection). Tracked so a
  // deselect doesn't yank an explicit typed reference, and a removed typed chip
  // doesn't try to deselect a card that was never selected.
  const [typedMentionIds, setTypedMentionIds] = useState<string[]>([]);
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
  // Composer attachments — context you attach before it's on the board (see below).
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachSeq = useRef(0);
  // Onboarding on-ramps are real buttons (they read as buttons — a dead click
  // there is a broken promise; owner call, 2026-07-11). "Drop a PDF" opens a
  // file picker into the attachment pipeline; the paste on-ramps focus the
  // composer with a transient how-to hint as its placeholder.
  const attachFileRef = useRef<HTMLInputElement>(null);
  const [onrampHint, setOnrampHint] = useState<string | null>(null);
  const focusComposerWithHint = (hint: string) => {
    setOnrampHint(hint);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.jz-promptbar-input')?.focus());
  };

  // ── Intent-first onboarding (a brand-new, empty board) ────────────────────
  const board = useSyncExternalStore(subscribeBoards, getActiveBoard, getActiveBoard);
  // Hosted-trial honesty, right where the person is about to ask — never let
  // the first prompt be the way they find out. Two states: no server at all
  // (static playground), or a keyless server answering with the scripted mock
  // (one tap from adding their own key and going live).
  const backend = useSyncExternalStore(subscribeBackend, getBackendSnapshot, getBackendSnapshot);
  // Every agent failure — an ask, a refine, an analyze, a debrief — surfaces
  // HERE, in one dismissible banner above the composer, never as a pill floating
  // at whatever canvas spot the work occupied (agentError.ts). One error at a
  // time, last-wins; Retry re-runs the exact action when the caller offers it.
  const agentError = useSyncExternalStore(subscribeAgentError, getAgentError, getAgentError);
  const chromeVisible = !isEmbed() && !isUseCases();
  const playground = backend.availability === 'down' && chromeVisible;
  const demoMode = backend.mode === 'demo' && chromeVisible;
  // An invited pilot whose budget ran out sees why the agents went quiet —
  // not a generic "demo mode" that reads like a bug.
  const pilotSpent = Boolean(backend.pilot && backend.pilot.used >= backend.pilot.limit);
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
  // The empty intent composer types example intents on its own, so the box is
  // alive and the intelligence shows before you commit. Purely a placeholder
  // animation — it never touches the real value or mode, and it stops the
  // moment you focus or type.
  const [focused, setFocused] = useState(false);
  const [introPh, setIntroPh] = useState('');
  const introAnim = introMode && !plainText.trim() && domMentions.length === 0 && !focused && attachments.length === 0 && !prefersReducedMotion();
  // Who's here — the persona modal's one-tap pick. Tuning is instant: starters
  // and the self-typing examples re-theme in place the moment a card is tapped.
  const persona = useSyncExternalStore(subscribePersona, getPersona, getPersona);
  const introStarters = INTRO_STARTERS[persona ?? 'default'];
  const introExamples = INTRO_ANIM[persona ?? 'default'];
  // The ambient scene stays alive until you actually reach for the composer —
  // focusing or typing hushes it the moment you engage, before the first send.
  const introEngaged = introMode && (focused || Boolean(plainText.trim()) || domMentions.length > 0 || attachments.length > 0);
  useEffect(() => {
    setOnboardingEngaged(introEngaged);
    return () => setOnboardingEngaged(false);
  }, [introEngaged]);
  useEffect(() => {
    if (!introAnim) { setIntroPh(''); return; }
    let alive = true;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((res) => { timers.push(window.setTimeout(res, ms) as unknown as number); });
    void (async () => {
      let i = 0;
      while (alive) {
        const ex = introExamples[i % introExamples.length]!;
        for (let c = 1; c <= ex.length && alive; c++) {
          setIntroPh(`${ex.slice(0, c)} ▏`);
          await wait(38);
        }
        if (!alive) break;
        setIntroPh(`${ex} ▏`);
        await wait(1900);
        for (let c = ex.length; c >= 0 && alive; c--) {
          setIntroPh(c > 0 ? `${ex.slice(0, c)} ▏` : '');
          await wait(16);
        }
        await wait(450);
        i += 1;
      }
    })();
    return () => { alive = false; timers.forEach((t) => window.clearTimeout(t)); };
    // Keyed on the persona too: a chip tap restarts the loop on that person's
    // examples immediately — the screen visibly reacts to the pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introAnim, persona]);
  // Inline filtering, Claude-Code style: while the input reads "/que…", the
  // menu narrows to matching modes. Opened from the button, it shows all.
  const modeQuery = plainText.startsWith('/') ? plainText.slice(1).trim().toLowerCase() : '';
  const visibleModes = modeQuery
    ? MODES.filter((m) => m.label.toLowerCase().startsWith(modeQuery) || m.shape.startsWith(modeQuery))
    : MODES;
  // Every askable board card, for the "@" picker — content-gated, so an empty
  // card (the user's own scratch space) is never offered as context.
  const askableCards = useValue<MentionCard[]>(
    'promptbar-cards',
    () =>
      editor
        .getCurrentPageShapes()
        .filter((s) => ASKABLE.has(s.type) && hasAskableContent(editor, s))
        .map((s) => ({ id: s.id, label: shapeLabel(editor, s), kind: cardKindNoun(s.type) })),
    [editor],
  );
  // The selected cards that qualify as context. Selection drops a synced
  // mention chip into the composer (and pulling the chip deselects) — the
  // effortless "click a card, ask about it" gesture, now inline in the prompt.
  const selectedAskableIds = useValue<string[]>(
    'promptbar-selected-askable',
    () =>
      editor.getSelectedShapeIds().filter((id) => {
        const s = editor.getShape(id);
        return Boolean(s && ASKABLE.has(s.type) && hasAskableContent(editor, s));
      }),
    [editor],
  );
  // Grounds ARE the mention chips: selection-synced ones plus anything typed
  // with "@". The composer's chip row is the single source of truth.
  const groundIds = domMentions;
  // Keep the composer's chips in lockstep with canvas selection: a newly
  // selected card gets a leading chip; a deselected card's chip goes — unless
  // it was ALSO typed with "@" (an explicit reference outlives the selection).
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const byId = new Map(askableCards.map((c) => [c.id, c] as const));
    for (const id of selectedAskableIds) {
      if (!domMentions.includes(id)) {
        const card = byId.get(id);
        if (card) input.insertMention(card, { prepend: true });
      }
    }
    for (const id of domMentions) {
      if (!selectedAskableIds.includes(id) && !typedMentionIds.includes(id)) {
        input.removeMention(id);
      }
    }
  }, [selectedAskableIds, domMentions, typedMentionIds, askableCards]);

  // The composer's model on every keystroke / chip change.
  const onModelChange = (m: MentionModel) => {
    setPlainText(m.plainText);
    setPromptText(m.promptText);
    setDomMentions(m.mentionIds);
    setModeIdx(0);
    if (onrampHint) setOnrampHint(null); // the hint served its moment
    // A leading "/" is a command: open the shape menu and filter it live.
    if (m.plainText.startsWith('/')) setModeMenu(true);
    else setModeMenu(false);
  };
  // The user picked a card from the "@" menu — a reference that stands on its
  // own, whether or not the card is selected on canvas.
  const onUserAddMention = (id: string) => {
    setTypedMentionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };
  // The user pulled a chip (its ✕ or a Backspace): deselect its card if it was
  // selected, and forget any typed reference to it.
  const onUserRemoveMention = (id: string) => {
    if (editor.getSelectedShapeIds().includes(id as TLShapeId)) {
      editor.setSelectedShapes(editor.getSelectedShapeIds().filter((x) => x !== id));
    }
    setTypedMentionIds((prev) => prev.filter((x) => x !== id));
  };
  // Drop typed references whose card has since been deleted, so a stale chip
  // can't linger pointing at nothing.
  useEffect(() => {
    const missing = typedMentionIds.filter((id) => !editor.getShape(id as TLShapeId));
    if (missing.length) {
      missing.forEach((id) => inputRef.current?.removeMention(id));
      setTypedMentionIds((prev) => prev.filter((id) => !missing.includes(id)));
    }
  }, [askableCards, typedMentionIds, editor]);
  // ── Composer attachments ──────────────────────────────────────────────────
  // Content you attach to the prompt as CONTEXT before it's on the board — a
  // transcript, a PDF, a screenshot. Distinct from grounding on a SELECTED card:
  // these persist in the composer regardless of canvas selection, and only
  // become source cards when you send. Works on the intent screen and in-app.
  const attachFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const kind = classifyFile(file);
      if (!kind) continue;
      const key = `att-${attachSeq.current++}`;
      setAttachments((list) => [...list, { key, kind, name: file.name, status: 'uploading' }]);
      void uploadAttachment(file, kind)
        .then((patch) => setAttachments((list) => list.map((a) => (a.key === key ? { ...a, ...patch } : a))))
        .catch(() => setAttachments((list) => list.map((a) => (a.key === key ? { ...a, status: 'error' } : a))));
    }
  };
  const removeAttachment = (key: string) => setAttachments((list) => list.filter((a) => a.key !== key));
  const attachUploading = attachments.some((a) => a.status === 'uploading');
  // Intercept a file drop/paste onto the composer at the document CAPTURE phase,
  // before tldraw's own canvas drop handler sees it — otherwise the file would
  // also land as a card on the board. A ref keeps the latest attachFiles without
  // re-binding the listeners each render.
  const barRef = useRef<HTMLDivElement>(null);
  const attachFilesRef = useRef(attachFiles);
  attachFilesRef.current = attachFiles;
  useEffect(() => {
    const inBar = (t: EventTarget | null) => t instanceof Node && Boolean(barRef.current?.contains(t));
    const hasFiles = (dt: DataTransfer | null) => Boolean(dt && Array.from(dt.types).includes('Files'));
    const onDragOver = (e: DragEvent) => {
      if (!inBar(e.target) || !hasFiles(e.dataTransfer)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    };
    const onDrop = (e: DragEvent) => {
      if (!inBar(e.target) || !hasFiles(e.dataTransfer)) return;
      e.preventDefault(); e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer) attachFilesRef.current(e.dataTransfer.files);
    };
    const onDragLeave = (e: DragEvent) => { if (!inBar(e.relatedTarget)) setDragActive(false); };
    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('drop', onDrop, true);
    document.addEventListener('dragleave', onDragLeave, true);
    return () => {
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('drop', onDrop, true);
      document.removeEventListener('dragleave', onDragLeave, true);
    };
  }, []);
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
    // Grounding the fill on its card selects it, which reconciles a leading
    // mention chip into the composer; the prose lands after it.
    if (fill.groundId && editor.getShape(fill.groundId)) editor.select(fill.groundId);
    inputRef.current?.setText(fill.text);
    setMode(null);
    setModeSource(null);
    requestAnimationFrame(() => inputRef.current?.focus());
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
    if (plainText.trim().length < 4 || plainText.startsWith('/')) {
      if (modeSource === 'auto') { setMode(null); setModeSource(null); }
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      void suggestShape(plainText, ac.signal).then((guess) => {
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
  }, [plainText, groundIds.length, modeSource]);

  // A transcript-looking text attachment auto-pins the Debrief recipe — the
  // detection is local (speaker-turn lines), the pin is the same suggestion
  // chip as the model's shape guesses: dismiss for a doc, tap to change, and
  // a user-owned choice is never overridden (G5).
  useEffect(() => {
    if (modeSource === 'user') return;
    const transcriptAttached = attachments.some((a) => a.kind === 'text' && a.text && looksLikeTranscript(a.text));
    if (transcriptAttached) {
      setMode('debrief');
      setModeSource('auto');
    } else if (mode === 'debrief' && modeSource === 'auto') {
      setMode(null);
      setModeSource(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, modeSource]);

  const pickMode = (shape: ModeShape) => {
    setMode(shape);
    setModeSource('user'); // an explicit pick — stop suggesting for this prompt.
    setModeMenu(false);
    setModeIdx(0);
    // Swallow the "/query" that summoned the menu — it was a command, not prose.
    if (plainText.startsWith('/')) inputRef.current?.setText('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const composing = composePhase === 'planning' || composePhase === 'building' || debriefPhase === 'building';
  const annotating = annotatePhase === 'thinking';
  // A grounded ask with no explicit mode. The TARGET is read from the PROMPT:
  //  - one card → does the instruction EDIT it in place or make a NEW card?
  //  - many @mentioned cards → which one (if any) does the prompt ask to update,
  //    with the rest as source material? ("rewrite @Board Update using @Q2").
  // An edit regenerates that card in place (keeping its shape); otherwise a
  // fresh doc lands, grounded on every reference. `grounds` carries all sources
  // (the target's own content plus the others) either way.
  const routeGroundedAsk = async (
    q: string,
    grounds: TLShapeId[],
    cards: Array<{ id: TLShapeId; title: string; type: string }>,
  ) => {
    let target: { id: TLShapeId; type: string } | null = null;
    if (cards.length === 1) {
      const c = cards[0]!;
      if (INLINE_EDITABLE.has(c.type) && (await classifyRefineIntent(q, c.type)) === 'edit') target = c;
    } else {
      const idx = await resolveMentionTarget(q, cards.map((c) => ({ title: c.title, type: c.type })));
      const picked = idx != null ? cards[idx] : null;
      if (picked && INLINE_EDITABLE.has(picked.type)) target = picked;
    }
    if (target) {
      void ask(q, grounds, { targetId: target.id, forceShape: REFINE_SHAPE[target.type], skipClarify: true });
    } else {
      void ask(q, grounds, { forceShape: 'doc' });
    }
  };

  const submit = () => {
    // Gate on PROSE: a bare mention with no instruction isn't a send (same as
    // an empty box today). The prompt we SEND is promptText — prose with each
    // mention rendered as the card it names, so "@Pricing" reads as a reference.
    const q = plainText.trim();
    const prompt = promptText.trim() || q;
    if (!q || isAsking || composing || annotating) return;
    if (attachUploading) return; // wait for attachments to finish uploading
    // Onboarding: the first ask sends the composer gliding down into its dock.
    if (introMode) leaveIntro();
    // Materialize any attachments into their source cards now (they weren't on
    // the board until send) and ground the ask on them alongside any selection.
    const attIds: TLShapeId[] = [];
    if (attachments.length) {
      const c = editor.getViewportPageBounds().center;
      attachments
        .filter((a) => a.status === 'ready')
        .forEach((a, i) => {
          const id = materializeAttachment(editor, a, { x: c.x + i * 28, y: c.y + i * 28 });
          if (id) attIds.push(id);
        });
      setAttachments([]);
    }
    const grounds = [...(groundIds as TLShapeId[]), ...attIds];
    // SHAPE is explicit only — no implicit routing from the prompt text. With no
    // mode selected the answer is always a DOC (the composer's first-class
    // default); Board / Stickies / any other shape require picking the "/" mode
    // (owner call 2026-07-07). Whether a typed instruction EDITS a selected card
    // in place vs makes a new card is inferred from intent (see routeSelectedAsk).
    if (mode === 'board') {
      void compose(prompt);
    } else if (mode === 'debrief') {
      // The debrief recipe reads the transcript among the grounds (the
      // materialized attachment or a selected text card). Without one it
      // degrades to a plain doc ask — never a dead send.
      void debrief(prompt, grounds).then((ran) => {
        if (!ran) void ask(prompt, grounds, { forceShape: 'doc' });
      });
    } else if (mode === 'affinity') {
      void annotate(prompt);
    } else if (!mode && attIds.length === 0 && groundIds.length >= 1) {
      // Grounded, no mode, nothing freshly attached → the prompt decides the
      // target: edit one referenced card in place (with the rest as sources),
      // or make a new doc. Works for one @mention or several.
      const cards = groundIds
        .map((id) => {
          const s = editor.getShape(id as TLShapeId);
          return s ? { id: id as TLShapeId, title: shapeLabel(editor, s), type: s.type as string } : null;
        })
        .filter((c): c is { id: TLShapeId; title: string; type: string } => Boolean(c));
      void routeGroundedAsk(prompt, grounds, cards);
    } else {
      void ask(prompt, grounds, { forceShape: (mode as AskShape) ?? 'doc' });
    }
    inputRef.current?.clear();
    setTypedMentionIds([]);
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
    inputRef.current?.setText(q);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Precedence: a just-clicked on-ramp's how-to hint wins, then an attached
  // file/text invites its instruction, then the grounded-selection ask.
  const placeholder = onrampHint
    ? onrampHint
    : attachments.length
      ? 'What should I do with this?'
      : groundIds.length
        ? 'Ask about the selection…'
        : 'What would you like to change or create?';
  const busyLabel = runningMode ? (runningMode === 'tensions' ? 'Scanning…' : runningMode === 'gaps' ? 'Reviewing…' : 'Critiquing…') : null;

  // Board-scan chips need enough substance to find gaps/tensions across cards.
  // Two contentful cards already qualify — a brief plus one generated artifact
  // is exactly when "what am I missing" earns its place (dogfood 2026-07-05;
  // the old ≥3 hid it right after the first table landed).
  // While a draft is on the board (streaming, or waiting on Keep/Discard),
  // every dock pill stands down: the pills describe the PREVIOUS card, and
  // they'd float over the fresh artefact and its controls (G4.2).
  const draftPending = useSyncExternalStore(subscribeDraft, () => Boolean(getDraft()), () => false);
  const showChips = !runningMode && !draftPending && groundIds.length === 0 && meaningfulCount >= 2;
  // Pills are ALWAYS contextual — generated from the card's own content.
  // Nothing scripted: until the tailored pills arrive (or if the card is
  // empty) we show nothing. Predictable operations live on the card's
  // floating bar (Refine), not here.
  const starters: Array<{ label: string; prompt: string }> =
    groundIds.length === 1 && (seeds?.length ?? 0) > 0
      ? seeds!.map((s) => ({ label: s.label, prompt: s.prompt }))
      : [];
  const showStarters = !runningMode && !isAsking && !soleBusy && !draftPending && !plainText.trim() && starters.length > 0;
  // The 5-20s quiet gap while tailored pills are being generated (cache still
  // undefined = fetch in flight): show shimmering placeholder pills so the
  // wait reads as "thinking", not "nothing here" (feel pass, ROADMAP §10 #4).
  const showSeedWait =
    !runningMode && !isAsking && !soleBusy && !draftPending && !plainText.trim() && groundIds.length === 1 && Boolean(sole) && seeds === undefined;

  return (
    <div className={`jz-promptbar-dock${introMode ? ' jz-promptbar-dock--intro' : ''}`} onPointerDown={stopEventPropagation}>
      {/* Intent-first onboarding: heading + starter prompts above the centred
          composer, which glides down to its dock as the first answer builds. */}
      {introMounted ? (
        <div className={`jz-pb-intro${introMode ? '' : ' jz-pb-intro--leaving'}`}>
          <span className="jz-pb-intro-spark" aria-hidden><JarwizSpark size={20} /></span>
          <h1 className="jz-pb-intro-head">{INTRO_HEAD[persona ?? 'default']}</h1>
          <p className="jz-pb-intro-sub">{INTRO_SUB[persona ?? 'default']}</p>
          <div className="jz-pb-intro-chips" key={persona ?? 'default'}>
            {introStarters.map((s) => (
              <button key={s.label} className="jz-pb-intro-chip" onClick={() => useStarter(s.prompt)} title="Use this prompt (editable)">{s.label}</button>
            ))}
          </div>
        </div>
      ) : null}
      {/* The coach bubble is gone: it described the two scan chips rendered
          directly beneath it (redundant teaching, permanent until dismissed,
          and part of the bottom-centre chrome pile-up — dogfood finding). */}
      {playground || demoMode ? (
        <div className="jz-pb-playground" role="status">
          <span className="jz-pb-playground-dot" aria-hidden />
          {playground
            ? PLAYGROUND_NOTICE
            : pilotSpent
              ? 'Demo actions used up — thank you for testing!'
              : DEMO_NOTICE}
          {demoMode ? (
            <button className="jz-pb-playground-cta" onClick={() => openSidePanel()}>
              Get full access
            </button>
          ) : null}
        </div>
      ) : null}
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
          <button className="jz-pb-chip" title="Name the due-diligence gaps on this board" onClick={() => runTool('gaps')}><JarwizSpark size={11} className="jz-spark-inline" /> What am I missing?</button>
        </div>
      ) : null}

      {/* Agent errors land here — the single home, right where the person is
          about to type. Dismissible; Retry re-runs the failed action. */}
      {agentError ? (
        <div className="jz-pb-error" role="alert">
          <span className="jz-pb-error-dot" aria-hidden />
          <span className="jz-pb-error-msg">{agentError.message}</span>
          {agentError.onRetry ? (
            <button className="jz-pb-error-retry" onClick={agentError.onRetry}>Retry</button>
          ) : null}
          <button className="jz-pb-error-x" aria-label="Dismiss" onClick={() => clearAgentError()}>✕</button>
        </div>
      ) : null}

      <div
        ref={barRef}
        className={`jz-promptbar${dragActive ? ' jz-promptbar--drag' : ''}`}
        style={{ '--pb-max': '560px' } as CSSProperties}
      >
        {/* This row is now ATTACHMENTS ONLY — context you brought in, kept as a
            dismissable chip. Selected cards are no longer pilled here; they ride
            inside the composer as inline @mention chips (MentionInput), so a
            card can be referenced anywhere in the prompt, not just as a header
            tag (owner call, 2026-07-13). */}
        {attachments.length > 0 ? (
          <div className="jz-pb-grounds">
            {attachments.map((a) => (
              <span
                key={a.key}
                className={`jz-pb-ground jz-pb-ground--attach${a.status === 'error' ? ' jz-pb-ground--error' : ''}`}
                title={a.status === 'error' ? `${a.name} · couldn’t attach` : a.status === 'uploading' ? `${a.name} · attaching…` : a.name}
              >
                {a.status === 'uploading' ? (
                  <span className="jz-pb-ground-spin" aria-hidden />
                ) : a.kind === 'text' ? (
                  <ClipboardList className="jz-pb-ground-clip" size={11} strokeWidth={2} aria-hidden />
                ) : (
                  <Paperclip className="jz-pb-ground-clip" size={11} strokeWidth={2} aria-hidden />
                )}
                <span className="jz-pb-ground-label">{a.kind === 'text' ? a.name : a.name.replace(/\.[^.]+$/, '')}</span>
                <button className="jz-pb-ground-x" aria-label="Remove attachment" onClick={() => removeAttachment(a.key)}>✕</button>
              </span>
            ))}
          </div>
        ) : null}

        <MentionInput
          ref={inputRef}
          placeholder={introAnim && introPh ? introPh : placeholder}
          cardOptions={askableCards}
          onChange={onModelChange}
          onUserAddMention={onUserAddMention}
          onUserRemoveMention={onUserRemoveMention}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setOnrampHint(null); }}
          // A pasted file (a screenshot, a PDF) attaches as context; a long
          // multi-line text paste (a transcript, notes) attaches too — it's
          // CONTENT to ground on, not the prompt. Short pastes become prose.
          onPasteFiles={(files) => {
            if (hasIngestibleFile(files)) { attachFiles(files); return true; }
            return false;
          }}
          onPasteText={(text) => {
            if (isAttachableText(text)) {
              setAttachments((list) => [...list, makeTextAttachment(`att-${attachSeq.current++}`, text)]);
              return true;
            }
            return false;
          }}
          // Fires only when the "@" card picker is closed — so the "/" shape
          // menu and Enter-to-send live here; the "@" menu owns its own keys.
          onKeyDown={(e) => {
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
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
            if (e.key === 'Escape') inputRef.current?.focus(); // stay put; menus close on blur
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
            {/* Attach — always available: drag/drop and paste attach too, but
                a visible button is the discoverable path (owner ask,
                2026-07-11). Opens the same picker the intro on-ramp uses. */}
            <button
              className="jz-promptbar-icon-btn"
              title="Attach a file — PDF, image, or spreadsheet"
              aria-label="Attach a file"
              onClick={() => attachFileRef.current?.click()}
            >
              <Paperclip size={15} strokeWidth={1.8} />
            </button>
            {/* The / button IS the mode selector; once a shape is picked the
                chip takes its place (dismiss to hand the choice back to the
                model). Same menu as typing "/" in the input. */}
            {mode ? (
              // ONE chip, one behaviour, whatever pinned it (a pick or the
              // suggester): the body opens the "/" menu to change the shape,
              // the ✕ clears back to a doc (owner call, 2026-07-11). The
              // natural gesture on a wrong guess — tapping it — lands in the
              // picker instead of doing nothing.
              <span
                key={`${mode}-${modeSource}`}
                role="button"
                tabIndex={0}
                className={`jz-pb-ground jz-pb-mode jz-pb-mode--tappable${modeSource === 'auto' ? ' jz-pb-mode--auto' : ''}`}
                title="Answer shape — click to change, ✕ for a doc"
                onClick={() => setModeMenu(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModeMenu(true); } }}
              >
                {modeSource === 'auto' ? <JarwizSpark className="jz-pb-mode-spark" size={11} aria-hidden /> : null}
                {MODES.find((m) => m.shape === mode)?.label ?? mode}
                <button
                  className="jz-pb-ground-x"
                  aria-label="Clear answer shape (write a doc)"
                  onClick={(e) => { e.stopPropagation(); setMode(null); setModeSource('user'); }}
                >✕</button>
              </span>
            ) : introMode ? (
              // Onboarding: no shape control and no preview pill — the composer's
              // self-typing example carries the intent on its own, so the footer
              // stays clean until the board opens (owner call, 2026-07-12).
              null
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
            // Carrying a busy label ("Planning…", "Scanning…"), the round
            // 30px button becomes a pill — the text no longer spills out of
            // the circle (G4.5).
            className={`jz-promptbar-send${composing || annotating || busyLabel ? ' jz-promptbar-send--busy' : ''}`}
            disabled={!plainText.trim() || attachUploading || isAsking || composing || annotating}
            onClick={submit}
            title={attachUploading ? 'Attaching…' : 'Send (Enter)'}
          >
            {composing ? (
              <span className="jz-promptbar-busy-inline">{debriefPhase === 'building' ? 'Debriefing…' : composePhase === 'planning' ? 'Planning…' : 'Building…'}</span>
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
        <div className={`jz-pb-onramp${introMode ? '' : ' jz-pb-onramp--leaving'}`}>
          <span className="jz-pb-onramp-or">or</span>
          <button
            className="jz-pb-onramp-item"
            onClick={() => attachFileRef.current?.click()}
          >
            <FileText size={13} strokeWidth={1.9} /> drop a PDF
          </button>
          <button
            className="jz-pb-onramp-item"
            onClick={() => focusComposerWithHint('Paste the link here (⌘V) and tell me what to do with it…')}
          >
            <Link2 size={13} strokeWidth={1.9} /> paste a link
          </button>
          <button
            className="jz-pb-onramp-item"
            onClick={() => focusComposerWithHint('Paste your transcript here (⌘V) and tell me what to make of it…')}
          >
            <ClipboardList size={13} strokeWidth={1.9} /> paste a transcript
          </button>
        </div>
      ) : null}

      {/* One hidden picker serves both attach entry points (the footer
          paperclip and the intro on-ramp) — always mounted. */}
      <input
        ref={attachFileRef}
        type="file"
        accept="application/pdf,.pdf,image/png,image/jpeg,image/gif,image/webp,.xlsx,.xls,.csv,.tsv"
        multiple
        hidden
        onChange={(e) => {
          if (e.currentTarget.files?.length) attachFiles(e.currentTarget.files);
          e.currentTarget.value = ''; // same file can be picked again
        }}
      />
    </div>
  );
}
