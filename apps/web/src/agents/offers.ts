/**
 * Proactive offers store — the cheap half of the hybrid model.
 *
 * When an artifact lands on the board (a YouTube video, an article link, a
 * PDF), ingestion raises a small cluster of agent-action *suggestions* here —
 * "Summarize", "Find related sources", "Make a comparison table" — each tied to
 * the agent that would do it (and an optional steering brief). The
 * SuggestionPills overlay renders them next to the card; one tap kicks off that
 * agent. No model tokens are spent until the user taps.
 *
 * Calm by default: one card's offer at a time. A newer drop supersedes the
 * older pending offer rather than stacking clusters.
 */

import type { AgentId } from '@jarwiz/shared';
import type { TLShapeId } from 'tldraw';

/** One proposed action: an agent + a button label + how to steer it. */
export interface Suggestion {
  id: string;
  /** Pill text, e.g. "Summarize" or "Make a comparison table". */
  label: string;
  /** Which agent would do it. */
  agentId: AgentId;
  /** Optional steering brief passed to the run (tone/length/format). */
  brief?: string;
}

export interface Offer {
  /** The card the offer is about (the pills anchor to it). */
  shapeId: TLShapeId;
  /** The proposed actions, in priority order. */
  suggestions: Suggestion[];
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

/** Raise an offer (replaces any pending one). Ignores an empty suggestion set. */
export function setOffer(shapeId: TLShapeId, suggestions: Suggestion[]): void {
  if (suggestions.length === 0) return;
  offer = { shapeId, suggestions };
  emit();
}

/**
 * Clear the current offer. When `shapeId` is given, only clears if it matches —
 * so dismissing a stale offer can't wipe a newer one.
 */
export function dismissOffer(shapeId?: TLShapeId): void {
  if (offer === null) return;
  if (shapeId !== undefined && offer.shapeId !== shapeId) return;
  offer = null;
  emit();
}
