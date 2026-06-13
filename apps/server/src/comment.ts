/**
 * Agent voice in comments — an agent replies, in conversation, to a card's
 * comment thread. This is the agent-as-participant idea at its most literal:
 * you @ a teammate in a thread and they answer in the same thread, briefly and
 * helpfully. Streams the reply as AutopilotEvent text deltas (real Anthropic or
 * scripted mock), sharing the push→pull bridge shape with autopilot.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAgent, type AutopilotEvent, type CommentReplyRequest } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';

const COMMENT_MAX_TOKENS = 320;

function systemPrompt(agentName: string, tagline: string): string {
  return `You are ${agentName}, an agent on the Jarwiz canvas (your specialty: ${tagline}). A human left a comment on a card and is talking to you in its thread. Reply the way a sharp teammate would in a comment: conversational, specific, and SHORT — 1 to 3 sentences, no headings, no preamble, no sign-off. Answer their actual question or react usefully to the card. If they're asking you to make something substantial (a draft, sources, a table), say briefly what you'd do and that they can summon you on the card to do it — don't try to produce the artifact here. Never invent specific facts you can't stand behind.`;
}

function buildUserTurn(request: CommentReplyRequest): string {
  const parts: string[] = [];
  parts.push(`The card (${request.cardKind}):`);
  if (request.cardTitle?.trim()) parts.push(`  title: ${request.cardTitle.trim()}`);
  if (request.cardText?.trim()) parts.push(`  content: """\n${request.cardText.trim()}\n"""`);
  parts.push('', 'Thread so far (oldest first):');
  for (const m of request.thread) parts.push(`  ${m.author}: ${m.text}`);
  parts.push('', `Write ${getAgent(request.agentId).name}'s next reply.`);
  return parts.join('\n');
}

function mockReply(request: CommentReplyRequest): string {
  const name = getAgent(request.agentId).name;
  const last = request.thread[request.thread.length - 1]?.text ?? '';
  return `(${name}, demo) Good question — "${last.slice(0, 48)}${last.length > 48 ? '…' : ''}". With an API key I'd answer this in the thread; summon me on the card and I'll do the real work. `;
}

function chunk(text: string, size = 5): string[] {
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

export async function* streamComment(
  request: CommentReplyRequest,
  signal: AbortSignal,
): AsyncGenerator<AutopilotEvent> {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (!hasKey) {
    for (const piece of chunk(mockReply(request))) {
      if (signal.aborted) return;
      yield { type: 'delta', textDelta: piece };
      await sleep(60, signal);
    }
    yield { type: 'done' };
    return;
  }

  const queue: AutopilotEvent[] = [];
  const waker: { fn: (() => void) | null } = { fn: null };
  let finished = false;
  const ping = () => {
    waker.fn?.();
    waker.fn = null;
  };
  const meta = getAgent(request.agentId);

  const run = (async () => {
    try {
      const client = new Anthropic();
      const stream = client.messages.stream(
        {
          model: AGENT_MODEL,
          max_tokens: COMMENT_MAX_TOKENS,
          system: [
            {
              type: 'text',
              text: systemPrompt(meta.name, meta.tagline),
              cache_control: { type: 'ephemeral' },
            },
          ],
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
        const message = error instanceof Error ? error.message : 'Reply failed';
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
