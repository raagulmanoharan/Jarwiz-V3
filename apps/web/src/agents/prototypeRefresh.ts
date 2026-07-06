/**
 * Prototype refresh bus — a "Reset" that reloads a prototype's live UI to its
 * initial state (re-running its inline JS: a timer back to 0, a form cleared, a
 * navigated screen back to the first) WITHOUT regenerating via the model. The
 * card body uses the per-shape counter as the iframe's React key, so bumping it
 * remounts the frame and re-renders the same HTML fresh.
 */

import type { TLShapeId } from 'tldraw';
import { createExternalStore } from '../lib/externalStore';

const store = createExternalStore<ReadonlyMap<TLShapeId, number>>(new Map());

export function refreshPrototype(id: TLShapeId): void {
  const next = new Map(store.get());
  next.set(id, (next.get(id) ?? 0) + 1);
  store.set(next);
}

export const subscribePrototypeRefresh = store.subscribe;
export function getPrototypeRefresh(id: TLShapeId): number {
  return store.get().get(id) ?? 0;
}
