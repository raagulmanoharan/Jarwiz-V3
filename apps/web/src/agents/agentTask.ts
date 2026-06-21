/**
 * Agent-task control store — the "one language" for an AI action in flight.
 * Presence (the avatar + status) shows the agent *working*; this carries the
 * controls every action needs at its destination: Cancel while running, and a
 * human error + Retry when it fails. Never silent, never a dead end.
 */

import type { TLShapeId } from 'tldraw';

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
