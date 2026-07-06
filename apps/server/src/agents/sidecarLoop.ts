/**
 * Sidecar agent runs — real Claude output (via the CLI sidecar) for the
 * text-producing agents when there's no API key. Unlike the full tool-use
 * runtime, this generates the artifact's content in one sidecar call and emits
 * the same board events (card.create → card.delta stream → card.done → edge),
 * so the canvas behaves identically but the content is genuinely real.
 *
 * Summarizer → one doc (the gist). Writer → one doc (a synthesis). Brainstormer
 * → a fan of sticky notes. The Researcher stays on the scripted mock (it needs
 * real, citable web sources — fabricating URLs would be dishonest).
 */

import type { AgentRunRequest, RunCard } from '@jarwiz/shared';
import type { AgentDefinition, EmitFn } from './runtime.js';
import { briefSuffix } from './runtime.js';
import { sidecarGenerate } from '../sidecar.js';

const SUMMARIZER_SYSTEM = `You are the Summarizer on a canvas. Given a source card, write "the gist at a glance" as tight markdown: an opening line with the core takeaway, then a few short bullets or one compact section. 120–220 words. If you only have a title/snippet (not full content), be honest and summarize what's known. Output ONLY the summary — no preamble.`;

const WRITER_SYSTEM = `You are the Writer on a canvas. Synthesize the provided cards into ONE long-form draft in clean markdown: a short opening stating the throughline, then 2–4 "## " sections with tight paragraphs (and lists where a flat enumeration reads better). Connect and contrast the inputs — don't just list them. 250–500 words. Output ONLY the draft, starting with a "# " title line.`;

const BRAINSTORMER_SYSTEM = `You are the Brainstormer on a canvas. Riff on the card with exactly 6 short, punchy, distinct ideas (angles, hooks, counterpoints, names). Output ONLY the 6 ideas, ONE per line, no numbering, no bullets, no preamble.`;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

function chunk(text: string, size = 18): string[] {
  const words = text.split(/(?<=\s)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(''));
  return out;
}

function describeCard(card: RunCard, label: string): string {
  const lines = [`${label} (${card.kind}):`];
  if (card.url) lines.push(`  url: ${card.url}`);
  if (card.title) lines.push(`  title: ${card.title}`);
  if (card.text) lines.push(`  content: """\n${card.text}\n"""`);
  return lines.join('\n');
}

function describeInputs(request: AgentRunRequest): string {
  const parts = [describeCard(request.source, 'Source card')];
  for (const extra of request.selection ?? []) {
    if (extra.cardId !== request.source.cardId) parts.push(describeCard(extra, 'Also selected'));
  }
  return parts.join('\n\n');
}

async function streamDoc(
  def: AgentDefinition,
  request: AgentRunRequest,
  system: string,
  emit: EmitFn,
  signal: AbortSignal,
  edgeLabel: string,
): Promise<void> {
  const { source, placement, selection } = request;
  await emit({ type: 'status', message: `${def.meta.name} is reading the selection…` });
  await emit({ type: 'cursor', x: source.x + source.w / 2, y: source.y + source.h / 2 });

  const text = await sidecarGenerate({
    system,
    user: describeInputs(request) + briefSuffix(request),
    signal,
  });
  if (signal.aborted) return;

  // Pull a "# Title" off the top if present; the rest is the body.
  const lines = text.split('\n');
  let title = source.title ? source.title.slice(0, 60) : 'Draft';
  let body = text;
  if (lines[0]?.startsWith('# ')) {
    title = lines[0].replace(/^#\s+/, '').slice(0, 80);
    body = lines.slice(1).join('\n').trim();
  }

  const cardId = 'card_1';
  await emit({ type: 'cursor', x: placement.x, y: placement.y });
  await emit({ type: 'card.create', cardId, kind: 'doc', x: placement.x, y: placement.y, title });
  await emit({ type: 'status', message: `${def.meta.name} is writing…` });
  for (const piece of chunk(body)) {
    if (signal.aborted) return;
    await emit({ type: 'card.delta', cardId, textDelta: piece });
    await sleep(45, signal);
  }
  await emit({ type: 'card.done', cardId });

  const inputs = [source.cardId, ...(selection ?? []).map((c) => c.cardId)];
  for (const fromId of [...new Set(inputs)]) {
    if (signal.aborted) return;
    await emit({ type: 'edge.create', fromCardId: fromId, toCardId: cardId, label: edgeLabel });
  }
  await emit({ type: 'done' });
}

async function runBrainstormer(
  def: AgentDefinition,
  request: AgentRunRequest,
  emit: EmitFn,
  signal: AbortSignal,
): Promise<void> {
  const { source, placement } = request;
  await emit({ type: 'status', message: `${def.meta.name} is riffing…` });
  await emit({ type: 'cursor', x: source.x + source.w / 2, y: source.y + source.h / 2 });

  const text = await sidecarGenerate({
    system: BRAINSTORMER_SYSTEM,
    user: describeInputs(request) + briefSuffix(request),
    signal,
  });
  if (signal.aborted) return;
  const ideas = text
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 6);

  const COLS = 3;
  for (let i = 0; i < ideas.length; i++) {
    if (signal.aborted) return;
    const cardId = `card_${i + 1}`;
    const x = placement.x + (i % COLS) * 240;
    const y = placement.y + Math.floor(i / COLS) * 200;
    await emit({ type: 'cursor', x, y });
    await emit({ type: 'card.create', cardId, kind: 'note', x, y, text: ideas[i] });
    await emit({ type: 'edge.create', fromCardId: source.cardId, toCardId: cardId, label: 'idea' });
    await sleep(120, signal);
  }
  await emit({ type: 'done' });
}

const TABLE_WRITER_SYSTEM = `You are the Writer. The user's request is a comparison/matrix. Build a comparison TABLE from the provided cards. Return ONLY a JSON object {"columns": string[], "rows": string[][]} — one column per dimension (the first column names the items), one row per item, short cells (a few words). No prose, no markdown, no code fences.`;

/** Does the request read as a comparison/matrix (→ a table, not prose)? */
function looksLikeComparison(request: AgentRunRequest): boolean {
  const hay = [
    request.brief ?? '',
    request.source.title ?? '',
    request.source.text ?? '',
    ...(request.selection ?? []).map((c) => `${c.title ?? ''} ${c.text ?? ''}`),
  ]
    .join(' ')
    .toLowerCase();
  return /\b(compare|comparison|vs\.?|versus|pros and cons|trade-?offs?|matrix|options|table)\b/.test(hay);
}

async function streamTable(
  def: AgentDefinition,
  request: AgentRunRequest,
  emit: EmitFn,
  signal: AbortSignal,
): Promise<void> {
  const { source, placement, selection } = request;
  await emit({ type: 'status', message: `${def.meta.name} sees a comparison — building a table…` });
  await emit({ type: 'cursor', x: source.x + source.w / 2, y: source.y + source.h / 2 });

  const raw = await sidecarGenerate({
    system: TABLE_WRITER_SYSTEM,
    user: describeInputs(request) + briefSuffix(request),
    signal,
  });
  if (signal.aborted) return;

  let columns: string[] = [];
  let rows: string[][] = [];
  try {
    const json = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as {
      columns?: unknown;
      rows?: unknown;
    };
    columns = Array.isArray(json.columns) ? json.columns.map((c) => String(c)) : [];
    rows = Array.isArray(json.rows)
      ? json.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : []))
      : [];
  } catch {
    /* fall back to a doc if the model didn't return clean JSON */
  }
  if (columns.length === 0) return streamDoc(def, request, WRITER_SYSTEM, emit, signal, 'drawn from');

  const cardId = 'card_1';
  await emit({ type: 'cursor', x: placement.x, y: placement.y });
  await emit({ type: 'card.create', cardId, kind: 'table', x: placement.x, y: placement.y, columns, rows });
  await emit({ type: 'status', message: `${def.meta.name} built a table` });

  const inputs = [source.cardId, ...(selection ?? []).map((c) => c.cardId)];
  for (const fromId of [...new Set(inputs)]) {
    if (signal.aborted) return;
    await emit({ type: 'edge.create', fromCardId: fromId, toCardId: cardId, label: 'drawn from' });
  }
  await emit({ type: 'done' });
}

export async function runSidecarLoop(
  def: AgentDefinition,
  request: AgentRunRequest,
  emit: EmitFn,
  signal: AbortSignal,
): Promise<void> {
  switch (def.meta.id) {
    case 'brainstormer':
      return runBrainstormer(def, request, emit, signal);
    case 'writer':
      // Response-shape routing: a comparison brief becomes a table, else a doc.
      return looksLikeComparison(request)
        ? streamTable(def, request, emit, signal)
        : streamDoc(def, request, WRITER_SYSTEM, emit, signal, 'drawn from');
    default: // summarizer
      return streamDoc(def, request, SUMMARIZER_SYSTEM, emit, signal, 'summary');
  }
}
