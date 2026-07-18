/**
 * Shared text streamer — yields a markdown generation token-by-token as SSE-able
 * events, so the slow "batch" agents (analyze, revise) feel as alive as a live stream.
 * Routes API (real Anthropic stream) → CLI sidecar (chunk the full reply) →
 * scripted mock (chunk). A push→pull bridge adapts the callback stream to an
 * async iterator.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';
import { anthropic, hasModelKey } from './model.js';

export type TextStreamEvent =
  | { type: 'delta'; textDelta: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface TextStreamOptions {
  system: string;
  user: string;
  signal: AbortSignal;
  maxTokens?: number;
  /** Scripted stand-in when there's no key and no sidecar. */
  mock?: () => string;
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

export async function* streamText(opts: TextStreamOptions): AsyncGenerator<TextStreamEvent> {
  const { system, user, signal, maxTokens = 1500 } = opts;
  const hasKey = Boolean(hasModelKey());

  // ── No key: real Claude via the CLI sidecar, else the scripted stand-in ──
  if (!hasKey) {
    if (sidecarAvailable()) {
      try {
        const text = await sidecarGenerate({ system, user, signal });
        for (const piece of chunk(text)) {
          if (signal.aborted) return;
          yield { type: 'delta', textDelta: piece };
          await sleep(28, signal);
        }
        yield { type: 'done' };
        return;
      } catch {
        if (signal.aborted) return; // else fall through to mock
      }
    }
    if (opts.mock) {
      for (const piece of chunk(opts.mock())) {
        if (signal.aborted) return;
        yield { type: 'delta', textDelta: piece };
        await sleep(55, signal);
      }
    }
    yield { type: 'done' };
    return;
  }

  // ── Real Anthropic stream via a push→pull bridge ────────────────────────
  const queue: TextStreamEvent[] = [];
  const waker: { fn: (() => void) | null } = { fn: null };
  let finished = false;
  const ping = () => { waker.fn?.(); waker.fn = null; };

  const run = (async () => {
    try {
      const client = anthropic();
      const stream = client.messages.stream(
        {
          model: AGENT_MODEL,
          max_tokens: maxTokens,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
        },
        { signal },
      );
      stream.on('text', (delta) => {
        if (delta.length > 0) { queue.push({ type: 'delta', textDelta: delta }); ping(); }
      });
      await stream.finalMessage();
    } catch (error) {
      if (!signal.aborted) {
        const message =
          error instanceof Anthropic.APIError
            ? `The agent couldn't finish (${error.status ?? 'API error'}).`
            : error instanceof Error ? error.message : 'The agent failed';
        queue.push({ type: 'error', message });
      }
    } finally {
      finished = true;
      ping();
    }
  })();

  let errored = false;
  while (true) {
    if (queue.length > 0) {
      const event = queue.shift()!;
      if (event.type === 'error') errored = true;
      yield event;
      continue;
    }
    if (finished) break;
    await new Promise<void>((resolve) => { waker.fn = resolve; });
  }
  await run;
  // An error already terminated the stream — never follow it with a done.
  if (!signal.aborted && !errored) yield { type: 'done' };
}
