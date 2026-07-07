/**
 * Focus-mode store — which card (if any) is open full-screen. An external
 * store (useSyncExternalStore-shaped, like presence/streaming) so the refine
 * bar can open focus from outside React state. One card at a time; the doc
 * card opens the rich editor (DocFocusOverlay), every other card opens the
 * read presentation (CardFocusOverlay). Both read this same store.
 */

import type { TLShapeId } from 'tldraw';

let current: TLShapeId | null = null;
const listeners = new Set<() => void>();

export function openCardFocus(id: TLShapeId): void {
  current = id;
  listeners.forEach((l) => l());
}

export function closeCardFocus(): void {
  current = null;
  listeners.forEach((l) => l());
}

export function getCardFocus(): TLShapeId | null {
  return current;
}

export function subscribeCardFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
