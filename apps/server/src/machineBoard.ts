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

import type { ComposeEvent } from '@jarwiz/shared';
import { RESEARCH_MAX_CONTINUATIONS, researchToolset } from './webTools.js';
import type { MachineSkill } from './machines.js';
import { generateText } from './generate.js';
import { parseJsonObject } from './util.js';

const MAX_TOKENS = 4000;
const SIDECAR_TIMEOUT_MS = 300_000;

/** A structured pass returning the model's raw text (JSON). `useTools` gates the
 *  deep web-research toolset: on for research machines (SWOT), off for a
 *  pure-reasoning machine (Effort–Impact) so it answers in one snappy call. */
function research(system: string, user: string, signal: AbortSignal, useTools = true): Promise<string> {
  return generateText({
    system,
    user,
    signal,
    maxTokens: MAX_TOKENS,
    sidecarTimeoutMs: SIDECAR_TIMEOUT_MS,
    web: useTools ? { tools: researchToolset(), maxTurns: RESEARCH_MAX_CONTINUATIONS } : undefined,
  });
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

/** SWOT board: the core 2×2 quadrants, then the optional strategy cards the user
 *  ticked (TOWS, Verdict) to the RIGHT — each taking the next free column so the
 *  board never leaves a gap when only one extra is enabled. */
function buildSwotCards(o: Record<string, unknown>, options: string[]): CardSpec[] {
  const tows = (o.tows ?? {}) as Record<string, unknown>;
  const towsRow = (label: string, key: string): string[] => [label, strList(tows[key]).join('\n')];
  const sources = Array.isArray(o.sources) ? (o.sources as Array<Record<string, unknown>>) : [];
  const sourceMd = sources
    .map((s, i) => `${s.n ?? i + 1}. ${String(s.title ?? 'source')} — ${String(s.url ?? '')}`)
    .join('\n');
  const priorities = strList(o.priorities).map((p, i) => `${i + 1}. ${p}`).join('\n');

  const cards: CardSpec[] = [
    // The SWOT 2×2: internal (top row) over external (bottom row).
    { title: 'Strengths', shape: 'list', md: bullets(o.strengths), col: 0, row: 0 },
    { title: 'Weaknesses', shape: 'list', md: bullets(o.weaknesses), col: 1, row: 0 },
    { title: 'Opportunities', shape: 'list', md: bullets(o.opportunities), col: 0, row: 1 },
    { title: 'Threats', shape: 'list', md: bullets(o.threats), col: 1, row: 1 },
  ];

  // Optional strategy cards sit to the RIGHT of the 2×2, each taking the next
  // free column so a single enabled extra never leaves a hole in the grid.
  let extraCol = 2;
  if (options.includes('tows')) {
    cards.push({
      title: 'TOWS — Strategic Moves',
      shape: 'table',
      col: extraCol++,
      row: 0,
      columns: ['Cross-strategy', 'Moves'],
      rows: [
        towsRow('Strengths × Opportunities (SO)', 'SO'),
        towsRow('Strengths × Threats (ST)', 'ST'),
        towsRow('Weaknesses × Opportunities (WO)', 'WO'),
        towsRow('Weaknesses × Threats (WT)', 'WT'),
      ],
    });
  }
  if (options.includes('verdict')) {
    cards.push({
      title: 'Strategic Verdict',
      shape: 'doc',
      col: extraCol++,
      row: 0,
      md: `${String(o.verdict ?? '').trim()}${priorities ? `\n\n## Top priorities\n${priorities}` : ''}${sourceMd ? `\n\n## Sources\n${sourceMd}` : ''}`,
    });
  }
  return cards;
}

/** A quadrant's items as a markdown bullet list (name in bold + a short note). */
function itemList(v: unknown): string {
  const items = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
  const md = items
    .map((it) => {
      const name = String(it?.name ?? '').trim();
      const note = String(it?.note ?? '').trim();
      if (!name) return '';
      return note ? `- **${name}** — ${note}` : `- ${name}`;
    })
    .filter(Boolean)
    .join('\n');
  return md || '_None_'; // keep the quadrant so the 2×2 grid stays intact
}

/** Effort–Impact board: the four quadrants of the 2×2 (columns = effort, rows =
 *  impact), then the optional score table + sequencing verdict to the right. */
function buildEffortImpactCards(o: Record<string, unknown>, options: string[]): CardSpec[] {
  const sources = Array.isArray(o.sources) ? (o.sources as Array<Record<string, unknown>>) : [];
  const sourceMd = sources
    .map((s, i) => `${s.n ?? i + 1}. ${String(s.title ?? 'source')} — ${String(s.url ?? '')}`)
    .join('\n');

  const cards: CardSpec[] = [
    // Top row = HIGH impact, bottom = LOW; left column = LOW effort, right = HIGH.
    { title: 'Quick wins · low effort, high impact', shape: 'list', md: itemList(o.quickWins), col: 0, row: 0 },
    { title: 'Big bets · high effort, high impact', shape: 'list', md: itemList(o.bigBets), col: 1, row: 0 },
    { title: 'Fill-ins · low effort, low impact', shape: 'list', md: itemList(o.fillIns), col: 0, row: 1 },
    { title: 'Time sinks · high effort, low impact', shape: 'list', md: itemList(o.timeSinks), col: 1, row: 1 },
  ];

  let extraCol = 2;
  if (options.includes('verdict')) {
    const verdict = String(o.verdict ?? '').trim();
    if (verdict) {
      cards.push({
        title: 'Sequencing verdict',
        shape: 'doc',
        col: extraCol++,
        row: 0,
        md: `${verdict}${sourceMd ? `\n\n## Sources\n${sourceMd}` : ''}`,
      });
    }
  }
  if (options.includes('scores')) {
    const rows = (Array.isArray(o.scores) ? (o.scores as Array<Record<string, unknown>>) : []).map((s) => [
      String(s.item ?? ''),
      String(s.impact ?? ''),
      String(s.effort ?? ''),
      String(s.quadrant ?? ''),
    ]);
    if (rows.length > 0) {
      cards.push({
        title: 'Scores',
        shape: 'table',
        col: extraCol++,
        row: 0,
        columns: ['Item', 'Impact', 'Effort', 'Quadrant'],
        rows,
      });
    }
  }
  return cards;
}

/** The registry of board builders, keyed by machine id. */
const BOARD_BUILDERS: Record<string, (o: Record<string, unknown>, options: string[]) => CardSpec[]> = {
  swot: buildSwotCards,
  effortimpact: buildEffortImpactCards,
};

/**
 * Run a board machine: one research pass → a set of cards, streamed as
 * ComposeEvents so the compose client renderer lays them out beside the block.
 */
export async function* streamMachineBoard(
  machine: MachineSkill,
  subject: string,
  signal: AbortSignal,
  options: string[] = [],
): AsyncGenerator<ComposeEvent> {
  const builder = BOARD_BUILDERS[machine.id];
  if (!builder) {
    yield { type: 'error', message: `No board layout for machine "${machine.id}".` };
    return;
  }
  let raw: string;
  try {
    raw = await research(machine.systemPrompt, subject.trim() || '(no subject)', signal, machine.deep);
  } catch (error) {
    yield { type: 'error', message: error instanceof Error ? error.message : 'Research failed' };
    return;
  }
  if (signal.aborted) return;
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    yield { type: 'error', message: 'Could not structure the research result.' };
    return;
  }

  // Honour only the optional outputs this skill actually declares — a guard so a
  // stale/forged option id from the client can't inject an unexpected card.
  const declared = new Set((machine.optionalOutputs ?? []).map((o) => o.id));
  const safeOptions = options.filter((id) => declared.has(id));
  const cards = builder(parsed, safeOptions).filter((c) => (c.shape === 'table' ? (c.columns?.length ?? 0) > 0 : (c.md ?? '').trim().length > 0));
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
