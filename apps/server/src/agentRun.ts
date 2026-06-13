/**
 * POST /api/agents/:agentId/run — the live agent runtime.
 *
 * Routes to the real Anthropic-powered agent loop or a mock demo mode, and
 * bridges their push-based `emit(event)` callback to a pull-based async
 * generator the SSE handler drains. Events are yielded **the moment they are
 * emitted** — never buffered to the end — so streaming text and cursor moves
 * reach the client live. Respects the AbortSignal (client disconnect).
 */

import type { AgentRunRequest, AgentEvent } from '@jarwiz/shared';
import type { AgentDefinition } from './agents/runtime.js';
import { runAgentLoop } from './agents/runtime.js';
import { runMockLoop } from './agents/mock.js';
import { summarizer } from './agents/summarizer.js';

const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
  summarizer,
  // researcher, brainstormer, writer arrive in later milestones
};

export async function* streamAgentRun(
  agentId: string,
  request: AgentRunRequest,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const agentDef = AGENT_DEFINITIONS[agentId];
  if (!agentDef) {
    yield { type: 'error', message: `Agent ${agentId} is not yet implemented.` };
    return;
  }

  // Push→pull bridge: emit() enqueues; the generator below dequeues live.
  const queue: AgentEvent[] = [];
  let wake: (() => void) | null = null;
  let finished = false;

  const emit = (event: AgentEvent): void => {
    queue.push(event);
    wake?.();
    wake = null;
  };

  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const runner = hasApiKey ? runAgentLoop : runMockLoop;

  const runPromise = runner(agentDef, request, emit, signal)
    .catch((error: unknown) => {
      if (!signal.aborted) {
        const message = error instanceof Error ? error.message : 'Agent run failed';
        queue.push({ type: 'error', message });
      }
    })
    .finally(() => {
      finished = true;
      wake?.();
      wake = null;
    });

  while (true) {
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    if (finished) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }

  await runPromise; // surface any late rejection / ensure cleanup ran
}
