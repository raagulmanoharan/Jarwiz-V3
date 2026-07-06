/**
 * In-place regeneration state. Unlike a new-card Ask (which shows the Keep /
 * Discard draft controls), an in-place tweak overwrites the selected card live
 * with no draft — so this tiny store lets a control float on the card while it
 * streams, showing "Regenerating…" with a Cancel that aborts the model call and
 * restores the card's previous content. One regeneration at a time.
 */

import type { TLShapeId } from 'tldraw';
import { createUiStore } from './uiStore';

export interface Regen {
  /** The card being regenerated in place. */
  id: TLShapeId;
  status: 'streaming';
}

const store = createUiStore<Regen>();
export const subscribeRegen = store.subscribe;
export const getRegen = store.get;
export const setRegen = store.set;
export const clearRegen = store.clear;
