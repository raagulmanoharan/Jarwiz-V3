/**
 * Dashboard run bus — a dashboard card asks to generate its OpenUI Lang spec
 * without the shape importing the Ask/fetch pipeline (shapes → ask → shapes
 * would be circular). buildDashboard creates the card and posts its id here; a
 * runner in the overlay (DashboardRunner) picks it up, calls the model, and
 * streams the spec back into the same card. Mirrors prototypeRun.
 */

import type { TLShapeId } from 'tldraw';
import { createExternalStore } from '../lib/externalStore';

export interface DashboardRunRequest {
  /** Monotonic token so re-generating the same card still fires the effect. */
  nonce: number;
  id: TLShapeId;
  /** The dashboard brief + the source data (CSV), sent as the ask prompt. */
  prompt: string;
}

const store = createExternalStore<DashboardRunRequest | null>(null);
let nonce = 0;

export function requestDashboardRun(id: TLShapeId, prompt: string): void {
  store.set({ nonce: ++nonce, id, prompt });
}

export const subscribeDashboardRun = store.subscribe;
export const getDashboardRun = store.get;
