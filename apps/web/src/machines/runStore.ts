/**
 * Machine run bus — a machine block on the canvas asks to be run without the
 * shape needing to import the Ask pipeline (which would be a circular dep:
 * shapes → ask → shapes). The block's Run button posts its id here; a runner in
 * the overlay (MachineRunner) picks it up, calls Ask, and updates the block.
 */

import type { TLShapeId } from 'tldraw';
import { createExternalStore } from '../lib/externalStore';

export interface MachineRunRequest {
  /** Monotonic token so re-running the same block still fires the effect. */
  nonce: number;
  id: TLShapeId;
}

const store = createExternalStore<MachineRunRequest | null>(null);
let nonce = 0;

export function requestMachineRun(id: TLShapeId): void {
  store.set({ nonce: ++nonce, id });
}

export const subscribeMachineRun = store.subscribe;
export const getMachineRun = store.get;
