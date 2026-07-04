/**
 * Claude side panel — a real conversational Claude stream.
 *
 * Keeps a multi-turn history on the client (sent with each request) so the
 * model has full context. The server is stateless: each POST carries the full
 * thread so far. Streams text deltas as `{ type: 'delta', textDelta }` then
 * `{ type: 'done' }`, same shape as autopilot so the client can reuse the
 * same consumer pattern.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Board context summary the client can optionally pass in. */
  boardContext?: string;
}

export type ChatEvent =
  | { type: 'delta'; textDelta: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

const CHAT_MAX_TOKENS = 2048;

const SYSTEM_PROMPT = `You are Claude, an AI assistant built into Jarwiz — an infinite canvas where ideas become artefacts. You're available as a side panel for direct conversation alongside the canvas.

Guidelines:
- Be concise and direct. The user is working; don't pad responses.
- You can see board context when provided — reference it naturally to ground your answers.
- Format with markdown when it helps (lists, bold, code blocks). Keep prose tight.
- You don't control the canvas directly from here — you're a thinking partner, not a canvas agent. If the user wants to generate something on the board, suggest they use the prompt bar.
- Be honest: don't invent facts, citations, or statistics.`;

function buildMessages(request: ChatRequest): Anthropic.Messages.MessageParam[] {
  const msgs: Anthropic.Messages.MessageParam[] = [];

  // Inject board context as a system-style primer in the first user turn.
  const history = request.messages.slice(-20); // keep last 20 turns, enough context
  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;
    let content = m.text;
    if (i === 0 && request.boardContext?.trim()) {
      content = `[Board context]\n${request.boardContext.trim()}\n\n---\n\n${content}`;
    }
    msgs.push({ role: m.role, content });
  }

  return msgs;
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

function chunk(text: string, size = 6): string[] {
  const words = text.split(/(?<=\s)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(''));
  return out;
}

export async function* streamChat(
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const messages = buildMessages(request);
  if (messages.length === 0) {
    yield { type: 'error', message: 'No messages provided.' };
    return;
  }

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (!hasKey) {
    if (sidecarAvailable()) {
      try {
        // Build a single-turn prompt for the sidecar from the last user message.
        const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
        const user = lastUser?.text ?? '';
        const text = await sidecarGenerate({ system: SYSTEM_PROMPT, user, signal });
        for (const piece of chunk(text)) {
          if (signal.aborted) return;
          yield { type: 'delta', textDelta: piece };
          await sleep(30, signal);
        }
        yield { type: 'done' };
        return;
      } catch {
        if (signal.aborted) return;
      }
    }
    // Demo fallback.
    const demo = 'I\'m running in demo mode (no ANTHROPIC_API_KEY set). Add a key to the server `.env` to enable real responses.';
    for (const piece of chunk(demo)) {
      if (signal.aborted) return;
      yield { type: 'delta', textDelta: piece };
      await sleep(50, signal);
    }
    yield { type: 'done' };
    return;
  }

  // Push→pull bridge — same pattern as autopilot.ts.
  const queue: ChatEvent[] = [];
  const waker: { fn: (() => void) | null } = { fn: null };
  let finished = false;
  const ping = () => { waker.fn?.(); waker.fn = null; };

  const run = (async () => {
    try {
      const client = new Anthropic();
      const stream = client.messages.stream(
        {
          model: AGENT_MODEL,
          max_tokens: CHAT_MAX_TOKENS,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages,
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
            ? `Claude couldn't respond (${error.status ?? 'API error'}).`
            : error instanceof Error
              ? error.message
              : 'Chat failed';
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
    await new Promise<void>((resolve) => { waker.fn = resolve; });
  }
  await run;
  if (!signal.aborted) yield { type: 'done' };
}
