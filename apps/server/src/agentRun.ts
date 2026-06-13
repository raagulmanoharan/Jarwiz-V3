/**
 * POST /api/agents/:agentId/run — the live agent runtime.
 *
 * Routes to the real Anthropic-powered agent loop or a mock demo mode.
 * Always respects the AbortSignal (client disconnect) and yields typed
 * AgentEvents that the client applies to the canvas via SSE.
 */

import type { AgentRunRequest, AgentEvent } from '@jarwiz/shared';
import { getAgent } from '@jarwiz/shared';
import { runAgentLoop } from './agents/runtime.js';
import { runMockLoop } from './agents/mock.js';
import { summarizer } from './agents/summarizer.js';

const AGENT_DEFINITIONS: Record<string, any> = {
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
    yield {
      type: 'error',
      message: `Agent ${agentId} is not yet implemented.`,
    };
    return;
  }

  // Collect events into an array, then yield them.
  const events: AgentEvent[] = [];
  const emit = (event: AgentEvent) => {
    events.push(event);
  };

  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  try {
    if (hasApiKey) {
      await runAgentLoop(agentDef, request, emit, signal);
    } else {
      await runMockLoop(agentDef, request, emit, signal);
    }
  } catch (error) {
    if (!signal.aborted) {
      const message = error instanceof Error ? error.message : 'Agent run failed';
      events.push({ type: 'error', message });
    }
  }

  for (const event of events) {
    yield event;
  }
}
