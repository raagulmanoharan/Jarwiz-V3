/**
 * Proactive offers store — the cheap half of the hybrid model.
 *
 * Client-side heuristics (in registerIngestion) watch what lands on the
 * board; when something is obviously summarizable (a YouTube link, an
 * article, a PDF) they raise a single, dismissible offer here. The
 * SuggestionChip renders it next to the card in the agent's color. No model
 * tokens are spent until the user taps — accepting starts a normal run.
 *
 * Calm by default: one offer at a time. A newer drop supersedes an older
 * pending offer rather than stacking chips.
 */

import type { AgentId } from '@jarwiz/shared';
import type { TLShapeId } from 'tldraw';

export interface Offer {
  /** The card the offer is about (the chip anchors to it). */
  shapeId: TLShapeId;
  /** Which agent is raising its hand. */
  agentId: AgentId;
  /** Chip text, e.g. "Summarize this?". */
  label: string;
}

let offer: Offer | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeOffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOffer(): Offer | null {
  return offer;
}

/** Raise an offer (replaces any pending one). */
export function setOffer(next: Offer): void {
  offer = next;
  emit();
}

/**
 * Clear the current offer. When `shapeId` is given, only clears if it
 * matches — so dismissing a stale offer can't wipe a newer one.
 */
export function dismissOffer(shapeId?: TLShapeId): void {
  if (offer === null) return;
  if (shapeId !== undefined && offer.shapeId !== shapeId) return;
  offer = null;
  emit();
}
