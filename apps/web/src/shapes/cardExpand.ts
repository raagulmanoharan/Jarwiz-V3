/**
 * Per-card expand state for answer cards that exceed the height threshold.
 * Collapsed (default) clamps the card to a max height with a fade + "Expand";
 * expanded shows the full content. Ephemeral, keyed by shape id.
 */

import type { TLShapeId } from 'tldraw';
import { createExternalStore } from '../lib/externalStore';

const store = createExternalStore<ReadonlySet<string>>(new Set());

export const subscribeExpand = store.subscribe;

export function isExpanded(id: TLShapeId): boolean {
  return store.get().has(id);
}

export function toggleExpand(id: TLShapeId): void {
  store.update((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}
