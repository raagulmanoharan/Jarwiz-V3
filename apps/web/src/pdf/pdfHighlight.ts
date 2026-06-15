/**
 * Per-reader highlight: a page + quoted text to mark in the text layer. Set when
 * you ask about a selected passage (so it stays highlighted) and re-applied when
 * you click the answer's [p.N] citation — returning you to the exact span.
 */

import type { TLShapeId } from 'tldraw';

export interface Highlight {
  page: number;
  quote: string;
}

const highlights = new Map<TLShapeId, Highlight>();
const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribePdfHighlight(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPdfHighlight(id: TLShapeId): Highlight | undefined {
  return highlights.get(id);
}

export function setPdfHighlight(id: TLShapeId, hl: Highlight | null): void {
  if (hl === null) highlights.delete(id);
  else highlights.set(id, hl);
  emit();
}
