/**
 * Proactive offers store — the cheap half of the hybrid model.
 *
 * When an artifact (or a *cluster* of related artifacts) lands on the board,
 * ingestion / clustering raises a small set of agent-action *suggestions* here.
 * The SuggestionPills overlay renders them next to the card(s); one tap kicks
 * off that agent on the card (or across the whole cluster). No model tokens are
 * spent until the user taps.
 *
 * One offer at a time; a newer one supersedes the older.
 */

import type { AgentId } from '@jarwiz/shared';
import type { TLShapeId } from 'tldraw';

/** One proposed action: an agent + a button label + how to steer it. */
export interface Suggestion {
  id: string;
  /** Pill text, e.g. "Summarize" or "Compare in a table". */
  label: string;
  /** Which agent would do it. */
  agentId: AgentId;
  /** Optional steering brief passed to the run (tone/length/format). */
  brief?: string;
}

export interface Offer {
  /** The card(s) the offer is about. One id for an artifact; many for a cluster. */
  shapeIds: TLShapeId[];
  /** The proposed actions, in priority order. */
  suggestions: Suggestion[];
  /** True while the server is reading the content to tailor the suggestions. */
  loading?: boolean;
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
export function setOffer(shapeIds: TLShapeId[], suggestions: Suggestion[], loading = false): void {
  if (shapeIds.length === 0 || suggestions.length === 0) return;
  offer = { shapeIds, suggestions, loading };
  emit();
}

/** True if there's a pending offer that includes this card (used to avoid races). */
export function hasOfferFor(shapeId: TLShapeId): boolean {
  return offer?.shapeIds.includes(shapeId) ?? false;
}

/**
 * True only if the current offer is for THIS single card (not a cluster). Used
 * so a card's slow content-aware upgrade can't clobber a cluster offer that the
 * card happens to be part of.
 */
export function isSoleOffer(shapeId: TLShapeId): boolean {
  return offer?.shapeIds.length === 1 && offer.shapeIds[0] === shapeId;
}

/**
 * Clear the current offer. When `shapeId` is given, only clears if the offer
 * includes it — so dismissing a stale offer can't wipe a newer one.
 */
export function dismissOffer(shapeId?: TLShapeId): void {
  if (offer === null) return;
  if (shapeId !== undefined && !offer.shapeIds.includes(shapeId)) return;
  offer = null;
  emit();
}
