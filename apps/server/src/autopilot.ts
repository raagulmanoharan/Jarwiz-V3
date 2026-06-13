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
import type { AutopilotEvent, AutopilotRequest } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';

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
