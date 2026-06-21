/**
 * Answer provenance (Big Rocks 2.2 — show your work). Records which source cards
 * an Ask answer was built from, so a "Based on: …" header can name them and zoom
 * to them. Session-scoped (an external store, not persisted) — the provenance
 * arrows on the canvas remain the durable record.
 */

import type { TLShapeId } from 'tldraw';

export interface Provenance {
  sourceIds: TLShapeId[];
  labels: string[];
}

let map: ReadonlyMap<TLShapeId, Provenance> = new Map();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function setProvenance(cardId: TLShapeId, sourceIds: TLShapeId[], labels: string[]): void {
  if (sourceIds.length === 0) return;
  const next = new Map(map);
  next.set(cardId, { sourceIds, labels });
  map = next;
  notify();
}

export function getProvenance(cardId: TLShapeId): Provenance | undefined {
  return map.get(cardId);
}

export function subscribeProvenance(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getProvenanceMap(): ReadonlyMap<TLShapeId, Provenance> {
  return map;
}
