/**
 * Agent presence store — the live state behind the differentiator.
 *
 * A tiny external store (consumed via useSyncExternalStore) that the SSE
 * consumer writes to as events arrive, and the dock + cursor overlay read
 * from. Keeping it outside React lets the agent loop drive presence without
 * prop-drilling through the canvas.
 *
 * Presence is honest: `status` mirrors what the agent is actually doing, and
 * `cursor` is whatever the latest `cursor` AgentEvent pointed at (page space).
 */

import type { AgentId } from '@jarwiz/shared';

export interface AgentPresence {
  /** Honest status text, or null when the agent is idle. */
  status: string | null;
  /** Latest cursor target in page (canvas) coordinates, or null. */
  cursor: { x: number; y: number } | null;
  /** True while a run is in flight. */
  active: boolean;
}

const IDLE: AgentPresence = { status: null, cursor: null, active: false };

type Snapshot = Readonly<Record<string, AgentPresence>>;

let state: Snapshot = {};
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribePresence(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPresenceSnapshot(): Snapshot {
  return state;
}

export function getAgentPresence(id: AgentId): AgentPresence {
  return state[id] ?? IDLE;
}

function patch(id: AgentId, next: Partial<AgentPresence>): void {
  const prev = state[id] ?? IDLE;
  state = { ...state, [id]: { ...prev, ...next } };
  emit();
}

/** A run is starting — mark active and clear any stale cursor/status. */
export function startPresence(id: AgentId): void {
  state = { ...state, [id]: { status: 'Starting…', cursor: null, active: true } };
  emit();
}

export function setPresenceStatus(id: AgentId, status: string): void {
  patch(id, { status });
}

export function setPresenceCursor(id: AgentId, x: number, y: number): void {
  patch(id, { cursor: { x, y } });
}

/** The run ended (done, error, or aborted) — back to idle. */
export function endPresence(id: AgentId): void {
  if (!state[id]) return;
  state = { ...state, [id]: IDLE };
  emit();
}
