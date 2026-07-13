/**
 * Agent-task control store — the "one language" for an AI action in flight.
 * Presence (the avatar + status) shows the agent *working*; this carries the
 * controls every action needs at its destination: Cancel while running, and a
 * human error + Retry when it fails. Never silent, never a dead end.
 */

import type { TLShapeId } from 'tldraw';
import { backendDown } from '../lib/backend';

export interface AgentTask {
  id: string;
  /** Anchor shape to position the control near (the work). */
  anchorId: TLShapeId | null;
  status: 'running' | 'error';
  label: string;
  error?: string;
  onCancel?: () => void;
  onRetry?: () => void;
}

let tasks: ReadonlyMap<string, AgentTask> = new Map();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setAgentTask(task: AgentTask): void {
  // On the hosted playground (no backend) every agent action fails for the one
  // same reason, and the standing "agents are off" notice above the composer
  // already owns that message. Spawning a per-action error pill with a Retry
  // that can never succeed is just redundant noise — swallow it, and clear any
  // running pill for the same action so it doesn't hang. (Only the futile
  // error state is suppressed; normal running/error elsewhere is untouched.)
  if (task.status === 'error' && backendDown()) {
    clearAgentTask(task.id);
    return;
  }
  const next = new Map(tasks);
  next.set(task.id, task);
  tasks = next;
  notify();
}

export function clearAgentTask(id: string): void {
  if (!tasks.has(id)) return;
  const next = new Map(tasks);
  next.delete(id);
  tasks = next;
  notify();
}

export function subscribeAgentTasks(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getAgentTasks(): ReadonlyMap<string, AgentTask> {
  return tasks;
}

/** Count of running tasks — used for the concurrency guard (Phase 2). */
export function runningTaskCount(): number {
  let n = 0;
  for (const t of tasks.values()) if (t.status === 'running') n++;
  return n;
}
