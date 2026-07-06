/**
 * Prototype run bus — a prototype card on the canvas asks to generate its UI
 * without the shape importing the Ask/fetch pipeline (which would be a circular
 * dep: shapes → ask → shapes). The card's Generate button posts its id here; a
 * runner in the overlay (PrototypeRunner) picks it up, calls the model, and
 * streams the HTML back into the same card.
 */

import type { TLShapeId } from 'tldraw';
import { createExternalStore } from '../lib/externalStore';

export interface PrototypeRunRequest {
  /** Monotonic token so re-generating the same card still fires the effect. */
  nonce: number;
  id: TLShapeId;
}

const store = createExternalStore<PrototypeRunRequest | null>(null);
let nonce = 0;

export function requestPrototypeRun(id: TLShapeId): void {
  store.set({ nonce: ++nonce, id });
}

export const subscribePrototypeRun = store.subscribe;
export const getPrototypeRun = store.get;
