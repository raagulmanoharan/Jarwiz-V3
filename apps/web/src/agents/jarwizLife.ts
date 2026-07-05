/**
 * The Jarwiz entity's attention feed. Ingestion (drop/paste) reports every
 * new card here, and the cursor layer's brain consumes the queue: it flies
 * the avatar over and holds a reading pose until the card's own processing
 * state resolves (link-preview fetch for link-cards, blob upload for
 * pdf-cards; images are instant so they get a short look). Kept outside
 * React so tldraw's external-content handlers never need a component.
 *
 * Presence stays honest: the queue only ever carries cards the USER added —
 * agent-created cards already have their own run choreography.
 */

import type { TLShapeId } from 'tldraw';

export type IngestKind = 'link' | 'pdf' | 'image';

export interface IngestedCard {
  id: TLShapeId;
  kind: IngestKind;
}

const queue: IngestedCard[] = [];

/** Ingestion calls this the moment a user-added card lands on the board. */
export function noteIngestion(id: TLShapeId, kind: IngestKind): void {
  queue.push({ id, kind });
}

/** The brain polls this when it's free to give something attention. */
export function takeIngested(): IngestedCard | undefined {
  return queue.shift();
}
