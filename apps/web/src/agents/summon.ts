/**
 * Summon channel — a tiny event bus so any surface (a card's @mention, the
 * participant roster, a future comment) can ask the run machinery to put an
 * agent to work on a card, without being wired to it directly.
 *
 * AgentPresenceLayer is the single consumer; it owns useAgentRun.
 */

import type { AgentId } from '@jarwiz/shared';
import type { TLShapeId } from 'tldraw';

export interface SummonRequest {
  agentId: AgentId;
  cardId: TLShapeId;
}

const listeners = new Set<(req: SummonRequest) => void>();

export function requestSummon(agentId: AgentId, cardId: TLShapeId): void {
  for (const l of listeners) l({ agentId, cardId });
}

export function onSummon(cb: (req: SummonRequest) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
