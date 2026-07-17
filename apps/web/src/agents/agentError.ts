/**
 * Agent errors have ONE home: a dismissible banner directly above the composer.
 * When an AI action fails — an ask, a refine, an analyze, a debrief — the reason
 * belongs where the person's attention already is (the prompt bar), not as a
 * pill floating at whatever canvas spot the work happened to occupy. Before this
 * store, a failure surfaced at the draft card or an anchored task pill, so the
 * same error read as "popping up in random places". This is the single surface.
 *
 * Kept deliberately tiny (one error at a time, last-wins): a failure is a modal
 * moment, not a feed. Retry, when the caller can offer it, re-runs the exact
 * action; dismiss clears it.
 */

import { backendDown } from '../lib/backend';

export interface AgentError {
  message: string;
  /** Re-run the failed action, when the caller can. Clears the banner itself. */
  onRetry?: () => void;
}

let current: AgentError | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setAgentError(err: AgentError): void {
  // On the hosted playground (no backend at all) every agent action fails for
  // the one same reason, and the standing "agents are off" notice above the
  // composer already owns that message — a second banner saying the same thing
  // is just noise. Swallow it there; every real backend error still shows.
  if (backendDown()) return;
  current = err;
  notify();
}

export function clearAgentError(): void {
  if (!current) return;
  current = null;
  notify();
}

export function subscribeAgentError(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getAgentError(): AgentError | null {
  return current;
}
