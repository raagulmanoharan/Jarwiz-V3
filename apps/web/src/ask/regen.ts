/**
 * In-place regeneration state. Unlike a new-card Ask (which shows the Keep /
 * Discard draft controls), an in-place tweak overwrites the selected card live
 * with no draft — so this tiny store lets a control float on the card while it
 * streams, showing "Regenerating…" with a Cancel that aborts the model call and
 * restores the card's previous content. One regeneration at a time.
 */

import type { TLShapeId } from 'tldraw';

export interface Regen {
  /** The card being regenerated in place. */
  id: TLShapeId;
  status: 'streaming';
}

let regen: Regen | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => cb());

export function subscribeRegen(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getRegen(): Regen | null {
  return regen;
}
export function setRegen(next: Regen | null): void {
  regen = next;
  emit();
}
export function clearRegen(): void {
  if (regen === null) return;
  regen = null;
  emit();
}
