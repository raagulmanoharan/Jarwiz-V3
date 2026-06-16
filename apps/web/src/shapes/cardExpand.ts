/**
 * Per-card expand state for answer cards that exceed the height threshold.
 * Collapsed (default) clamps the card to a max height with a fade + "Expand";
 * expanded shows the full content. Ephemeral, keyed by shape id.
 */

import type { TLShapeId } from 'tldraw';

/** Answer cards taller than this collapse, with an expand/collapse toggle. */
export const MAX_CARD_H = 520;

const expanded = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => cb());

export function subscribeExpand(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function isExpanded(id: TLShapeId): boolean {
  return expanded.has(id);
}
export function toggleExpand(id: TLShapeId): void {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  emit();
}
