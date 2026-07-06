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
    case 'writer':
      return runWriterMock(def, request, step, signal);
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

/* ─── Writer: one long-form draft, connected to every input ─────────────── */

function mockDraftText(request: AgentRunRequest): string {
  const inputs = [request.source, ...(request.selection ?? [])];
  const n = new Set(inputs.map((c) => c.cardId)).size;
  return [
    `**Demo mode** — no ANTHROPIC_API_KEY is set, so this is a scripted stand-in draft synthesizing the ${n} selected card${n === 1 ? '' : 's'}.`,
    '',
    'A real Writer run would weave your selection into a single argument — not a list of what each card said, but a throughline that connects and contrasts them.',
    '',
    '## What it draws from',
    '',
    'Every selected card becomes a thread: the seed idea sets the brief, sources lend evidence, and notes add angles. The Writer reads each one (fetching link sources with web_fetch when only a URL is given) before drafting.',
    '',
    '## How it reads',
    '',
    'Clean markdown, an editorial title, two to four sections, tight paragraphs. The aim is a draft you would be glad to keep and edit in place — right here on the card.',
    '',
    '## What stays honest',
    '',
    'No invented quotes or statistics; if a source could not be read, the draft says so. When it finishes, a green "drawn from" edge connects this draft back to each input, so the board remembers where the thinking came from.',
    '',
    'Add an API key to `apps/server/.env` and run this again for the real synthesis.',
  ].join('\n');
}

/** Cheap intent sniff so the demo can show format routing (doc vs table). */
function looksLikeComparison(request: AgentRunRequest): boolean {
  const hay = [request.source, ...(request.selection ?? [])]
    .map((c) => `${c.title ?? ''} ${c.text ?? ''}`)
    .join(' ')
    .toLowerCase();
  return /\b(compare|comparison|vs\.?|versus|options|pros and cons|trade-?offs?|matrix|table)\b/.test(
    hay,
  );
}

async function runWriterTableMock(
  def: AgentDefinition,
  request: AgentRunRequest,
  step: StepFn,
  signal: AbortSignal,
): Promise<void> {
  const { source, placement } = request;
  const cardId = 'card_1';
  if (!(await step({ type: 'status', message: `${def.meta.name} sees a comparison — building a table… (demo)` }, 420)))
    return;
  if (!(await step({ type: 'cursor', x: placement.x, y: placement.y }, 420))) return;
  if (
    !(await step({
      type: 'card.create',
      cardId,
      kind: 'table',
      x: placement.x,
      y: placement.y,
      columns: ['Option', 'Cost', 'Strengths', 'Watch-outs'],
      rows: [
        ['Option A', '$', 'Fast to adopt (demo)', 'Limited ceiling'],
        ['Option B', '$$', 'Balanced (demo)', 'Setup effort'],
        ['Option C', '$$$', 'Most powerful (demo)', 'Overkill for small teams'],
      ],
    }))
  ) {
    return;
  }
  if (signal.aborted) return;
  await step({
    type: 'edge.create',
    fromCardId: source.cardId,
    toCardId: cardId,
    label: 'drawn from',
  });
  await step({ type: 'status', message: `${def.meta.name} is done (demo)` }, 0);
  await step({ type: 'done' }, 0);
}

async function runWriterMock(
  def: AgentDefinition,
  request: AgentRunRequest,
  step: StepFn,
  signal: AbortSignal,
): Promise<void> {
  // Format routing: a comparison brief becomes a table, everything else a doc.
  if (looksLikeComparison(request)) return runWriterTableMock(def, request, step, signal);

  const { source, placement } = request;
  const cardId = 'card_1';

  if (!(await step({ type: 'status', message: `${def.meta.name} is reading the selection… (demo)` }, 420)))
    return;
  if (!(await step({ type: 'cursor', x: placement.x, y: placement.y }, 420))) return;
  if (
    !(await step({
      type: 'card.create',
      cardId,
      kind: 'doc',
      x: placement.x,
      y: placement.y,
      title: source.title ? `Draft: ${source.title.slice(0, 56)}` : 'Demo draft',
    }))
  ) {
    return;
  }
  if (!(await step({ type: 'status', message: `${def.meta.name} is drafting… (demo)` }))) return;

  for (const chunk of chunkText(mockDraftText(request), 40)) {
    if (!(await step({ type: 'card.delta', cardId, textDelta: chunk }, 70))) return;
  }

  if (!(await step({ type: 'card.done', cardId }))) return;

  // Connect the draft back to every distinct input card.
  const inputIds = [source.cardId, ...(request.selection ?? []).map((c) => c.cardId)];
  for (const fromId of [...new Set(inputIds)]) {
    if (
      !(await step({ type: 'edge.create', fromCardId: fromId, toCardId: cardId, label: 'drawn from' }))
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
