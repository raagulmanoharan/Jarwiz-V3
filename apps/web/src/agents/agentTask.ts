/**
 * Agent-task control store — the "one language" for an AI action in flight.
 * Presence (the avatar + status) shows the agent *working*; this carries the
 * Cancel control at the work while it runs. When a task FAILS, the error no
 * longer lives here as an anchored pill — it's forwarded to the agent-error
 * banner above the composer (agentError.ts), the single home for failures, so
 * a dead action never pops up at a random canvas spot. Never silent, never a
 * dead end.
 */

import type { TLShapeId } from 'tldraw';
import { backendDown } from '../lib/backend';
import { setAgentError } from './agentError';

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
  // A FAILED task doesn't render at the work — its error belongs in the one
  // banner above the composer (agentError.ts). Clear any running pill for this
  // action so it doesn't hang, then hand the message + Retry to that banner.
  // (On the hosted playground agentError swallows it — the standing "agents are
  // off" notice already owns that reason.)
  if (task.status === 'error') {
    clearAgentTask(task.id);
    if (task.error && !backendDown()) {
      setAgentError({ message: task.error, onRetry: task.onRetry });
    }
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
