/**
 * Machine BOARD output — a machine that fans its analysis out into a framework
 * of cards, not one doc. One deep research pass returns a structured result;
 * we then emit several cards from it (ComposeEvents, reusing the compose client
 * renderer). SWOT becomes the four S/W/O/T quadrants + a TOWS cross-strategy
 * table + a strategic verdict — richer than, and clearly not, an ask.
 *
 * The research runs ONCE (efficient + consistent); the cards are derived from
 * the JSON, so the fan-out is instant after the research lands.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ComposeEvent } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';
import { RESEARCH_MAX_CONTINUATIONS, researchToolset } from './webTools.js';
import type { MachineSkill } from './machines.js';

const MAX_TOKENS = 4000;
const SIDECAR_TIMEOUT_MS = 300_000;

/** One deep, tool-using research pass; returns the model's raw text (JSON). */
async function research(system: string, user: string, signal: AbortSignal): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const client = new Anthropic();
    const tools = researchToolset();
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
    let text = '';
    for (let turn = 0; turn <= RESEARCH_MAX_CONTINUATIONS; turn++) {
      const msg = await client.messages.create(
        { model: AGENT_MODEL, max_tokens: MAX_TOKENS, system, messages, tools },
        { signal },
      );
      text += msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (msg.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: msg.content });
    }
    return text;
  }
  if (sidecarAvailable()) {
    return sidecarGenerate({ system, user, signal, web: true, timeoutMs: SIDECAR_TIMEOUT_MS });
  }
  throw new Error('No model available (set ANTHROPIC_API_KEY or install the Claude CLI).');
}

function parseObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
const bullets = (v: unknown): string => strList(v).map((s) => `- ${s}`).join('\n');

interface CardSpec {
  title: string;
  shape: 'doc' | 'list' | 'table';
  md?: string;
  columns?: string[];
  rows?: string[][];
  /** Grid placement — the client lays a machine board out as a grid. */
  col: number;
  row: number;
  /** Columns spanned (default 1); a full-width card is span 2. */
  span?: number;
}

/** SWOT board: build the six cards from the structured research result. */
function buildSwotCards(o: Record<string, unknown>): CardSpec[] {
  const tows = (o.tows ?? {}) as Record<string, unknown>;
  const towsRow = (label: string, key: string): string[] => [label, strList(tows[key]).join('\n')];
  const sources = Array.isArray(o.sources) ? (o.sources as Array<Record<string, unknown>>) : [];
  const sourceMd = sources
    .map((s, i) => `${s.n ?? i + 1}. ${String(s.title ?? 'source')} — ${String(s.url ?? '')}`)
    .join('\n');
  const priorities = strList(o.priorities).map((p, i) => `${i + 1}. ${p}`).join('\n');

  return [
    // The SWOT 2×2: internal (top row) over external (bottom row).
    { title: 'Strengths', shape: 'list', md: bullets(o.strengths), col: 0, row: 0 },
    { title: 'Weaknesses', shape: 'list', md: bullets(o.weaknesses), col: 1, row: 0 },
    { title: 'Opportunities', shape: 'list', md: bullets(o.opportunities), col: 0, row: 1 },
    { title: 'Threats', shape: 'list', md: bullets(o.threats), col: 1, row: 1 },
    // The strategy row beneath the matrix — TOWS and the verdict side by side.
    {
      title: 'TOWS — Strategic Moves',
      shape: 'table',
      col: 0,
      row: 2,
      columns: ['Cross-strategy', 'Moves'],
      rows: [
        towsRow('Strengths × Opportunities (SO)', 'SO'),
        towsRow('Strengths × Threats (ST)', 'ST'),
        towsRow('Weaknesses × Opportunities (WO)', 'WO'),
        towsRow('Weaknesses × Threats (WT)', 'WT'),
      ],
    },
    {
      title: 'Strategic Verdict',
      shape: 'doc',
      col: 1,
      row: 2,
      md: `${String(o.verdict ?? '').trim()}${priorities ? `\n\n## Top priorities\n${priorities}` : ''}${sourceMd ? `\n\n## Sources\n${sourceMd}` : ''}`,
    },
  ];
}

/** The registry of board builders, keyed by machine id. */
const BOARD_BUILDERS: Record<string, (o: Record<string, unknown>) => CardSpec[]> = {
  swot: buildSwotCards,
};

/**
 * Run a board machine: one research pass → a set of cards, streamed as
 * ComposeEvents so the compose client renderer lays them out beside the block.
 */
export async function* streamMachineBoard(
  machine: MachineSkill,
  subject: string,
  signal: AbortSignal,
): AsyncGenerator<ComposeEvent> {
  const builder = BOARD_BUILDERS[machine.id];
  if (!builder) {
    yield { type: 'error', message: `No board layout for machine "${machine.id}".` };
    return;
  }
  let raw: string;
  try {
    raw = await research(machine.systemPrompt, subject.trim() || '(no subject)', signal);
  } catch (error) {
    yield { type: 'error', message: error instanceof Error ? error.message : 'Research failed' };
    return;
  }
  if (signal.aborted) return;
  const parsed = parseObject(raw);
  if (!parsed) {
    yield { type: 'error', message: 'Could not structure the research result.' };
    return;
  }

  const cards = builder(parsed).filter((c) => (c.shape === 'table' ? (c.columns?.length ?? 0) > 0 : (c.md ?? '').trim().length > 0));
  if (cards.length === 0) {
    yield { type: 'error', message: 'The analysis came back empty.' };
    return;
  }

  yield {
    type: 'plan',
    cards: cards.map((c, i) => ({ slot: i, type: c.shape, title: c.title, col: c.col, row: c.row, span: c.span ?? 1 })),
  };
  for (let i = 0; i < cards.length; i++) {
    if (signal.aborted) return;
    const c = cards[i]!;
    if (c.shape === 'table') {
      const columns = c.columns ?? [];
      const rows = c.rows ?? [];
      yield { type: 'slot', slot: i, event: { type: 'card.create', shape: 'table', columns, rowCount: rows.length } };
      for (let r = 0; r < rows.length; r++) {
        for (let col = 0; col < columns.length; col++) {
          yield { type: 'slot', slot: i, event: { type: 'table.cell', r, c: col, text: rows[r]?.[col] ?? '' } };
        }
      }
      yield { type: 'slot', slot: i, event: { type: 'card.done' } };
    } else {
      yield { type: 'slot', slot: i, event: { type: 'card.create', shape: c.shape } };
      yield { type: 'slot', slot: i, event: { type: 'card.delta', textDelta: c.md ?? '' } };
      yield { type: 'slot', slot: i, event: { type: 'card.done' } };
    }
  }
  yield { type: 'done' };
}
