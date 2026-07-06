/**
 * Focus-mode store — which text card (if any) is open in the full-screen
 * editor (DocFocusOverlay). External store, useSyncExternalStore-shaped,
 * like presence/streaming: the refine bar opens it from outside React state.
 */

import type { TLShapeId } from 'tldraw';

let current: TLShapeId | null = null;
const listeners = new Set<() => void>();

export function openDocFocus(id: TLShapeId): void {
  current = id;
  listeners.forEach((l) => l());
}

export function closeDocFocus(): void {
  current = null;
  listeners.forEach((l) => l());
}

export function getDocFocus(): TLShapeId | null {
  return current;
}

export function subscribeDocFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
