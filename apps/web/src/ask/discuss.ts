/**
 * Per-card discussion threads (Big Rocks 3.3 — conversational depth). Session
 * store of the back-and-forth on a doc card, so a multi-turn argument stays
 * attached to the one artifact it's about.
 */

import type { TLShapeId } from 'tldraw';
import type { ReviseTurn } from '@jarwiz/shared';

let threads: ReadonlyMap<TLShapeId, ReviseTurn[]> = new Map();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function getThread(id: TLShapeId): ReviseTurn[] {
  return threads.get(id) ?? [];
}

export function addTurn(id: TLShapeId, turn: ReviseTurn): void {
  const next = new Map(threads);
  next.set(id, [...(threads.get(id) ?? []), turn]);
  threads = next;
  notify();
}

export function subscribeDiscuss(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getThreads(): ReadonlyMap<TLShapeId, ReviseTurn[]> {
  return threads;
}
