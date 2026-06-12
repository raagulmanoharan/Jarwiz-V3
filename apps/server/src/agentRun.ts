/**
 * POST /api/agents/:agentId/run — the SSE protocol stub for Milestone 0.
 *
 * Emits a small scripted sequence of typed AgentEvents with correct SSE
 * framing (`data: {json}\n\n`). This proves the wire protocol end to end;
 * the real agent loop (Anthropic tool use → canvas actions) lands in M1.
 */

import type { AgentEvent, AgentMeta } from '@jarwiz/shared';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The scripted M0 sequence: status → status → done. */
export function scriptedRun(agent: AgentMeta): AgentEvent[] {
  return [
    { type: 'status', message: `${agent.name} is warming up…` },
    { type: 'status', message: `${agent.name} is standing by — agent runtime arrives in Milestone 1` },
    { type: 'done' },
  ];
}

export async function* streamScriptedRun(
  agent: AgentMeta,
  stepDelayMs = 350,
): AsyncGenerator<AgentEvent> {
  for (const event of scriptedRun(agent)) {
    yield event;
    if (event.type !== 'done') await sleep(stepDelayMs);
  }
}
