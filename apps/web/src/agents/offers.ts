/**
 * Proactive offers store — the cheap half of the hybrid model.
 *
 * MULTIPLE offers can be live at once: every dropped artifact carries its own
 * pills, and a cluster of related artifacts carries cross-cutting pills — they
 * coexist (a card gets "its own pills plus the cluster pills"). Each offer is
 * keyed: `art:<shapeId>` for an artifact, `cluster:<id>` for a cluster.
 *
 * The SuggestionPills overlay renders them all; tapping one kicks off its agent
 * on the card(s). No model tokens are spent until the user taps.
 */

import type { AgentId } from '@jarwiz/shared';
import type { TLShapeId } from 'tldraw';

/** One proposed action: an agent + a button label + how to steer it. */
export interface Suggestion {
  id: string;
  label: string;
  agentId: AgentId;
  brief?: string;
}

export interface Offer {
  /** Stable key: `art:<shapeId>` or `cluster:<id>`. */
  id: string;
  kind: 'artifact' | 'cluster';
  /** The card(s) the offer is about. One id for an artifact; many for a cluster. */
  shapeIds: TLShapeId[];
  suggestions: Suggestion[];
  /** True while the server is reading the content to tailor the suggestions. */
  loading?: boolean;
}

let offers = new Map<string, Offer>();
const listeners = new Set<() => void>();
let snapshot: Offer[] = [];

function emit(): void {
  snapshot = [...offers.values()];
  for (const listener of listeners) listener();
}

export function subscribeOffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable array snapshot for useSyncExternalStore. */
export function getOffers(): Offer[] {
  return snapshot;
}

export function getOffer(id: string): Offer | undefined {
  return offers.get(id);
}

export function hasOffer(id: string): boolean {
  return offers.has(id);
}

export const artifactOfferId = (shapeId: TLShapeId): string => `art:${shapeId}`;

/** Raise / update an offer. Ignores an empty suggestion set. */
export function upsertOffer(offer: Offer): void {
  if (offer.shapeIds.length === 0 || offer.suggestions.length === 0) return;
  offers = new Map(offers);
  offers.set(offer.id, offer);
  emit();
}

export function dismissOffer(id: string): void {
  if (!offers.has(id)) return;
  offers = new Map(offers);
  offers.delete(id);
  emit();
}

/** Drop every offer that references a (deleted) card. */
export function removeOffersForShape(shapeId: TLShapeId): void {
  let changed = false;
  const next = new Map(offers);
  for (const [id, o] of offers) {
    if (o.shapeIds.includes(shapeId)) {
      next.delete(id);
      changed = true;
    }
  }
  if (changed) {
    offers = next;
    emit();
  }
}
