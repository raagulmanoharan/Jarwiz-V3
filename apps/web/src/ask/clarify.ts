/**
 * A pending clarifying question. When the server judges an Ask genuinely
 * ambiguous it returns one short question with a few tappable options instead
 * of guessing; this store holds it (plus everything needed to re-run the Ask
 * once the user answers, with the answer folded in). One question at a time.
 */

import type { TLShapeId } from 'tldraw';
import { createUiStore } from './uiStore';

export interface Clarify {
  question: string;
  options: string[];
  /** The original prompt + sources, so answering re-runs the same Ask. */
  prompt: string;
  sourceIds: TLShapeId[];
  targetId: TLShapeId | null;
}

const store = createUiStore<Clarify>();
export const subscribeClarify = store.subscribe;
export const getClarify = store.get;
export const setClarify = store.set;
export const clearClarify = store.clear;
