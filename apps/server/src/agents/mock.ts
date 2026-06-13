/**
 * Demo-mode agent runs — used when ANTHROPIC_API_KEY is unset.
 *
 * Exercises the full wire protocol deterministically for each agent so the
 * product stays demoable without a key and e2e tests have a stable target:
 *   - Summarizer → one streamed doc card, connected.
 *   - Researcher → a fan of link cards, each connected.
 *   - Brainstormer → a fan of sticky notes, each connected.
 * Statuses are clearly labeled as demo mode — presence is honest even mocked.
 *
 * Shares the emission path with the real runtime: both drive the same EmitFn
 * with the same AgentEvent shapes.
 */

import type { AgentDefinition, EmitFn } from './runtime.js';
import type { AgentRunRequest } from '@jarwiz/shared';

const STEP_DELAY_MS = 110;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

export async function runMockLoop(
  def: AgentDefinition,
  request: AgentRunRequest,
  emit: EmitFn,
  signal: AbortSignal,
): Promise<void> {
  const { source } = request;

  const step = async (event: Parameters<EmitFn>[0], delay = STEP_DELAY_MS) => {
    if (signal.aborted) return false;
    await emit(event);
    await sleep(delay, signal);
    return !signal.aborted;
  };

  // Walk over to the source first (shared opening for every agent).
  if (!(await step({ type: 'status', message: `${def.meta.name} — demo mode (no API key)` })))
    return;
  if (
    !(await step({ type: 'cursor', x: source.x + source.w / 2, y: source.y + source.h / 2 }, 420))
  ) {
    return;
  }

  switch (def.meta.id) {
    case 'researcher':
      return runResearcherMock(def, request, step, signal);
    case 'brainstormer':
      return runBrainstormerMock(def, request, step, signal);
    default:
      return runSummarizerMock(def, request, step, signal);
  }
}

type StepFn = (event: Parameters<EmitFn>[0], delay?: number) => Promise<boolean>;

/* ─── Summarizer: one streamed doc card ─────────────────────────────────── */

function mockSummaryText(request: AgentRunRequest): string {
  const { source } = request;
  const what =
    source.kind === 'youtube'
      ? `the video${source.title ? ` “${source.title}”` : ''}`
      : source.url
        ? `the page at ${source.url}`
        : `the selected ${source.kind} card`;
  return [
    `**Demo mode** — the server has no ANTHROPIC_API_KEY, so this is a scripted stand-in summary of ${what}.`,
    '',
    'What a real run would do here:',
    '',
    '- Fetch the source with the Anthropic server-side web_fetch tool (or use YouTube metadata, honestly labeled).',
    '- Stream the actual gist onto this card word by word, exactly like this text just did.',
    '- Connect the card back to its source with an amber provenance edge.',
    '',
    'Add an API key to `apps/server/.env` and run this again for the real thing.',
  ].join('\n');
}

function chunkText(text: string, count: number): string[] {
  const words = text.split(/(?<=\s)/);
  const perChunk = Math.max(1, Math.ceil(words.length / count));
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += perChunk) {
    chunks.push(words.slice(i, i + perChunk).join(''));
  }
  return chunks;
}

async function runSummarizerMock(
  def: AgentDefinition,
  request: AgentRunRequest,
  step: StepFn,
  signal: AbortSignal,
): Promise<void> {
  const { source, placement } = request;
  const cardId = 'card_1';

  if (!(await step({ type: 'status', message: `${def.meta.name} is looking at the source… (demo)` })))
    return;
  if (!(await step({ type: 'cursor', x: placement.x, y: placement.y }, 420))) return;
  if (
    !(await step({
      type: 'card.create',
      cardId,
      kind: 'doc',
      x: placement.x,
      y: placement.y,
      title: source.title ? `Gist: ${source.title.slice(0, 60)}` : 'Demo summary',
    }))
  ) {
    return;
  }
  if (!(await step({ type: 'status', message: `${def.meta.name} is writing… (demo)` }))) return;

  for (const chunk of chunkText(mockSummaryText(request), 20)) {
    if (!(await step({ type: 'card.delta', cardId, textDelta: chunk }, 90))) return;
  }

  if (!(await step({ type: 'card.done', cardId }))) return;
  if (
    !(await step({
      type: 'edge.create',
      fromCardId: source.cardId,
      toCardId: cardId,
      label: 'summary',
    }))
  ) {
    return;
  }
  if (signal.aborted) return;
  await step({ type: 'status', message: `${def.meta.name} is done (demo)` }, 0);
  await step({ type: 'done' }, 0);
}

/* ─── Researcher: a fan of link cards ───────────────────────────────────── */

async function runResearcherMock(
  def: AgentDefinition,
  request: AgentRunRequest,
  step: StepFn,
  signal: AbortSignal,
): Promise<void> {
  const { source, placement } = request;

  if (!(await step({ type: 'status', message: `${def.meta.name} is searching the web… (demo)` }, 420)))
    return;

  const sources = [
    { url: 'https://example.com/study', title: 'A representative study', desc: 'Demo source — a real run cites a study via web_search.' },
    { url: 'https://example.com/article', title: 'A strong explainer article', desc: 'Demo source — a real run finds a high-quality article.' },
    { url: 'https://example.com/counterview', title: 'A notable counter-view', desc: 'Demo source — a real run includes a diverse perspective.' },
  ];

  for (let i = 0; i < sources.length; i++) {
    const cardId = `card_${i + 1}`;
    const x = placement.x;
    const y = placement.y + i * 180;
    const s = sources[i]!;
    if (!(await step({ type: 'cursor', x, y }, 320))) return;
    if (
      !(await step({
        type: 'card.create',
        cardId,
        kind: 'link',
        x,
        y,
        title: s.title,
        url: s.url,
        text: s.desc,
      }))
    ) {
      return;
    }
    if (!(await step({ type: 'status', message: `${def.meta.name} added a source (demo)` }))) return;
    if (
      !(await step({
        type: 'edge.create',
        fromCardId: source.cardId,
        toCardId: cardId,
        label: 'source',
      }))
    ) {
      return;
    }
  }

  if (signal.aborted) return;
  await step({ type: 'status', message: `${def.meta.name} is done (demo)` }, 0);
  await step({ type: 'done' }, 0);
}

/* ─── Brainstormer: a fan of sticky notes ───────────────────────────────── */

async function runBrainstormerMock(
  def: AgentDefinition,
  request: AgentRunRequest,
  step: StepFn,
  signal: AbortSignal,
): Promise<void> {
  const { source, placement } = request;

  if (!(await step({ type: 'status', message: `${def.meta.name} is riffing… (demo)` }, 420))) return;

  const ideas = [
    'Open with a bold, counterintuitive claim',
    'Frame it as a myth vs. reality',
    'Lead with a personal failure story',
    'A contrarian take to provoke debate',
    'Name it something memorable and sticky',
    'End on a single actionable takeaway',
  ];

  const COLS = 3;
  for (let i = 0; i < ideas.length; i++) {
    const cardId = `card_${i + 1}`;
    const x = placement.x + (i % COLS) * 240;
    const y = placement.y + Math.floor(i / COLS) * 200;
    if (!(await step({ type: 'cursor', x, y }, 260))) return;
    if (!(await step({ type: 'card.create', cardId, kind: 'note', x, y, text: `${ideas[i]} (demo)` })))
      return;
    if (
      !(await step({
        type: 'edge.create',
        fromCardId: source.cardId,
        toCardId: cardId,
        label: 'idea',
      }))
    ) {
      return;
    }
  }

  if (signal.aborted) return;
  await step({ type: 'status', message: `${def.meta.name} is done (demo)` }, 0);
  await step({ type: 'done' }, 0);
}
