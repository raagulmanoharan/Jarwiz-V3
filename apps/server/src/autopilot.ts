/**
 * Autopilot (Tab-to-continue) — stream a bounded prose continuation for the
 * card the user is editing, from where their caret stopped. See ROADMAP §9.
 *
 * This is intentionally NOT the agentic canvas loop: no tools, no card
 * creation, no edges. Just text → text. The model continues the user's writing
 * in their voice and format; the client appends the deltas at the caret live.
 * Routes to a real Anthropic stream (key present) or a scripted mock (no key),
 * sharing one push→pull bridge with the same AutopilotEvent shapes.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AutopilotEvent,
  AutopilotRequest,
  TableAutopilotEvent,
  TableAutopilotRequest,
} from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';

/** Bounded per the spec — a paragraph or a few bullets, never a runaway. */
const AUTOPILOT_MAX_TOKENS = 400;

const SYSTEM_PROMPT = `You are Autopilot, an in-place writing copilot on the Jarwiz canvas. The user is editing a card and pressed Tab to have you continue their writing from exactly where their cursor stopped.

Rules (follow exactly):
- Continue the text naturally. Output ONLY the continuation — never repeat or restate what is already there, and never add a preamble like "Here is the continuation".
- Match the existing voice, tense, person, and formatting. If the text uses markdown (headings, bullets), keep using it; if it's a plain sticky note, stay terse.
- If the text ends mid-word or mid-sentence, complete it seamlessly; if it ends at a clean break, begin the next natural unit (the next sentence, bullet, or short paragraph).
- Keep it bounded: a sentence or two, a few bullets, or one short paragraph — enough to give momentum, not a whole essay. The user will press Tab again for more.
- Start your output with the exact whitespace needed to join cleanly (a leading space if continuing a sentence, a newline if starting a new line/bullet).
- Be honest and concrete; never invent specific facts, names, quotes, or statistics you can't stand behind.`;

function buildUserTurn(request: AutopilotRequest): string {
  const parts: string[] = [];
  if (request.title?.trim()) parts.push(`Document title: ${request.title.trim()}`, '');
  parts.push(
    request.kind === 'note' ? 'This is a short sticky note.' : 'This is a markdown document.',
    '',
    'Text so far (continue from the very end of it):',
    '"""',
    request.text,
    '"""',
  );
  return parts.join('\n');
}

function mockContinuation(request: AutopilotRequest): string {
  if (request.kind === 'note') {
    return ' — and a crisp next beat the agent would add here (demo: set ANTHROPIC_API_KEY for the real continuation).';
  }
  return [
    '',
    '',
    'From here, Autopilot would carry the thought forward in your voice — picking up the argument where you left it, in the same markdown rhythm, a paragraph at a time.',
    '',
    'Press Tab again and it extends further; start typing and it hands the pen straight back. (Demo mode: add ANTHROPIC_API_KEY for a real continuation.)',
  ].join('\n');
}

function chunk(text: string, size = 6): string[] {
  const words = text.split(/(?<=\s)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(''));
  return out;
}

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

export async function* streamAutopilot(
  request: AutopilotRequest,
  signal: AbortSignal,
): AsyncGenerator<AutopilotEvent> {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (!hasKey) {
    // Real Claude via the CLI sidecar; fall back to the scripted stand-in.
    if (sidecarAvailable()) {
      try {
        const text = await sidecarGenerate({ system: SYSTEM_PROMPT, user: buildUserTurn(request), signal });
        for (const piece of chunk(text)) {
          if (signal.aborted) return;
          yield { type: 'delta', textDelta: piece };
          await sleep(40, signal);
        }
        yield { type: 'done' };
        return;
      } catch {
        if (signal.aborted) return; // else fall through to the scripted stand-in
      }
    }
    for (const piece of chunk(mockContinuation(request))) {
      if (signal.aborted) return;
      yield { type: 'delta', textDelta: piece };
      await sleep(70, signal);
    }
    yield { type: 'done' };
    return;
  }

  // Push→pull bridge so streamed text reaches the client the moment it arrives.
  // A holder object (not a `let`) keeps `wake` from being CFA-narrowed to null
  // inside the closures below.
  const queue: AutopilotEvent[] = [];
  const waker: { fn: (() => void) | null } = { fn: null };
  let finished = false;
  const ping = () => {
    waker.fn?.();
    waker.fn = null;
  };

  const run = (async () => {
    try {
      const client = new Anthropic();
      const stream = client.messages.stream(
        {
          model: AGENT_MODEL,
          max_tokens: AUTOPILOT_MAX_TOKENS,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: buildUserTurn(request) }],
        },
        { signal },
      );
      stream.on('text', (delta) => {
        if (delta.length > 0) {
          queue.push({ type: 'delta', textDelta: delta });
          ping();
        }
      });
      await stream.finalMessage();
    } catch (error) {
      if (!signal.aborted) {
        const message =
          error instanceof Anthropic.APIError
            ? `Autopilot couldn't continue (${error.status ?? 'API error'}).`
            : error instanceof Error
              ? error.message
              : 'Autopilot failed';
        queue.push({ type: 'error', message });
      }
    } finally {
      finished = true;
      ping();
    }
  })();

  while (true) {
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    if (finished) break;
    await new Promise<void>((resolve) => {
      waker.fn = resolve;
    });
  }
  await run;
  if (!signal.aborted) yield { type: 'done' };
}

/* ─── Table cell-fill (A1) ──────────────────────────────────────────────── */

/** Row-major list of the empty cells the agent should fill. */
function emptyCells(rows: string[][]): Array<{ row: number; col: number }> {
  const out: Array<{ row: number; col: number }> = [];
  rows.forEach((r, row) =>
    r.forEach((cell, col) => {
      if (!cell?.trim()) out.push({ row, col });
    }),
  );
  return out;
}

const TABLE_SYSTEM_PROMPT = `You fill in the empty cells of a small table on a canvas. You are given the column headers and the current rows (some cells filled by the user, some empty). Return ONLY a JSON object of the form {"rows": string[][]} with the SAME number of rows and the SAME number of columns as the input. Keep every already-filled cell EXACTLY as given. Fill each empty cell with a concise, accurate value that fits its column header and stays consistent with the other cells in its row. Values are short — a few words, not sentences. Output only the JSON object: no prose, no markdown, no code fences.`;

async function fetchFilledRows(
  request: TableAutopilotRequest,
  signal: AbortSignal,
): Promise<string[][]> {
  const client = new Anthropic();
  const userTurn = JSON.stringify({ columns: request.columns, rows: request.rows });
  const message = await client.messages.create(
    {
      model: AGENT_MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: TABLE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userTurn }],
    },
    { signal },
  );
  const text = message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return parseRows(text);
}

/** Tolerantly parse a {"rows": string[][]} object from a model's text reply. */
function parseRows(raw: string): string[][] {
  const text = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const parsed = JSON.parse(text) as { rows?: unknown };
  if (!Array.isArray(parsed.rows)) throw new Error('bad table JSON');
  return parsed.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : []));
}

/** Real fill via the CLI sidecar (no API key). */
async function fetchFilledRowsSidecar(
  request: TableAutopilotRequest,
  signal: AbortSignal,
): Promise<string[][]> {
  const user = JSON.stringify({ columns: request.columns, rows: request.rows });
  const text = await sidecarGenerate({ system: TABLE_SYSTEM_PROMPT, user, signal });
  return parseRows(text);
}

function mockCell(request: TableAutopilotRequest, row: number, col: number): string {
  const header = (request.columns[col] ?? '').toLowerCase();
  const subject = request.rows[row]?.find((c) => c?.trim()) ?? `row ${row + 1}`;
  if (col === 0) return `Option ${row + 1}`;
  if (header.includes('cost') || header.includes('price')) return ['$', '$$', '$$$'][row % 3] ?? '$';
  if (header.includes('pro') || header.includes('strength')) return `Strong fit for ${subject}`;
  if (header.includes('con') || header.includes('watch')) return `Watch the trade-offs`;
  return `${subject} — demo`;
}

export async function* streamTableAutopilot(
  request: TableAutopilotRequest,
  signal: AbortSignal,
): AsyncGenerator<TableAutopilotEvent> {
  const targets = emptyCells(request.rows);
  if (targets.length === 0) {
    yield { type: 'done' };
    return;
  }

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  let filled: string[][] | null = null;
  if (!hasKey && sidecarAvailable()) {
    try {
      filled = await fetchFilledRowsSidecar(request, signal);
    } catch {
      if (signal.aborted) return; // else fall through to scripted mockCell values
    }
  } else if (hasKey) {
    try {
      filled = await fetchFilledRows(request, signal);
    } catch (error) {
      if (signal.aborted) return;
      const message =
        error instanceof Anthropic.APIError
          ? `Autopilot couldn't fill the table (${error.status ?? 'API error'}).`
          : 'Autopilot couldn\'t parse a table from the model.';
      yield { type: 'error', message };
      return;
    }
  }

  // Emit one cell at a time, in visiting order, so the avatar hops the grid.
  for (const { row, col } of targets) {
    if (signal.aborted) return;
    const candidate = filled?.[row]?.[col];
    const text = candidate && candidate.trim() ? candidate : mockCell(request, row, col);
    yield { type: 'cell', row, col, text };
    await sleep(260, signal);
  }
  if (!signal.aborted) yield { type: 'done' };
}
