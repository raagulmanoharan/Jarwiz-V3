/**
 * Demo-mode agent run — used when ANTHROPIC_API_KEY is unset.
 *
 * Exercises the full wire protocol deterministically (status → cursor →
 * card.create → ~20 card.delta chunks → card.done → edge.create → done)
 * with small delays, so the product stays demoable without a key and e2e
 * tests have a stable target. Statuses are clearly labeled as demo mode —
 * presence is honest even when mocked.
 *
 * Shares the emission path with the real runtime: both drive the same
 * EmitFn with the same AgentEvent shapes.
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

/** A plausible, clearly-labeled summary body for the demo run. */
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

/** Split text into ~`count` word-ish chunks, preserving whitespace. */
function chunkText(text: string, count: number): string[] {
  const words = text.split(/(?<=\s)/); // keep trailing whitespace on each token
  const perChunk = Math.max(1, Math.ceil(words.length / count));
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += perChunk) {
    chunks.push(words.slice(i, i + perChunk).join(''));
  }
  return chunks;
}

export async function runMockLoop(
  def: AgentDefinition,
  request: AgentRunRequest,
  emit: EmitFn,
  signal: AbortSignal,
): Promise<void> {
  const { meta } = def;
  const { source, placement } = request;
  const cardId = 'card_1';

  const step = async (event: Parameters<EmitFn>[0], delay = STEP_DELAY_MS) => {
    if (signal.aborted) return false;
    await emit(event);
    await sleep(delay, signal);
    return !signal.aborted;
  };

  if (!(await step({ type: 'status', message: `${meta.name} — demo mode (no API key)` }))) return;
  if (
    !(await step({ type: 'cursor', x: source.x + source.w / 2, y: source.y + source.h / 2 }, 450))
  ) {
    return;
  }
  if (!(await step({ type: 'status', message: `${meta.name} is looking at the source… (demo)` })))
    return;
  if (!(await step({ type: 'cursor', x: placement.x, y: placement.y }, 450))) return;
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
  if (!(await step({ type: 'status', message: `${meta.name} is writing… (demo)` }))) return;

  for (const chunk of chunkText(mockSummaryText(request), 20)) {
    if (!(await step({ type: 'card.delta', cardId, textDelta: chunk }, 90))) return;
  }

  if (!(await step({ type: 'card.done', cardId }))) return;
  if (
    !(await step({ type: 'status', message: `${meta.name} is connecting it to the source… (demo)` }))
  ) {
    return;
  }
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
  await emit({ type: 'status', message: `${meta.name} is done (demo)` });
  await emit({ type: 'done' });
}
