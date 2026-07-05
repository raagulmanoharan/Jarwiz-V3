/**
 * Prompt-fill bus — lets any overlay hand a ready-made prompt to the prompt bar
 * without wiring a ref through the tree. A comment's "let Jarwiz fix it" action
 * (and future affordances) calls requestPromptFill; the PromptBar subscribes,
 * drops the text in, grounds it on the given card, and focuses — the user
 * reviews and hits Enter. Deliberately non-destructive: we prefill, never send.
 */

import type { TLShapeId } from 'tldraw';
import { createExternalStore } from '../lib/externalStore';

export interface PromptFill {
  /** Monotonic token so the same text twice still triggers the effect. */
  nonce: number;
  text: string;
  /** Card to select as grounding context (optional). */
  groundId?: TLShapeId;
}

const store = createExternalStore<PromptFill | null>(null);
let nonce = 0;

export function requestPromptFill(text: string, groundId?: TLShapeId): void {
  store.set({ nonce: ++nonce, text, groundId });
}

export const subscribePromptFill = store.subscribe;
export const getPromptFill = store.get;
