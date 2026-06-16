/**
 * A pending clarifying question. When the server judges an Ask genuinely
 * ambiguous it returns one short question with a few tappable options instead
 * of guessing; this store holds it (plus everything needed to re-run the Ask
 * once the user answers, with the answer folded in). One question at a time.
 */

import type { TLShapeId } from 'tldraw';

export interface Clarify {
  question: string;
  options: string[];
  /** The original prompt + sources, so answering re-runs the same Ask. */
  prompt: string;
  sourceIds: TLShapeId[];
  targetId: TLShapeId | null;
}

let clarify: Clarify | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => cb());

export function subscribeClarify(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getClarify(): Clarify | null {
  return clarify;
}
export function setClarify(next: Clarify | null): void {
  clarify = next;
  emit();
}
export function clearClarify(): void {
  if (clarify === null) return;
  clarify = null;
  emit();
}
