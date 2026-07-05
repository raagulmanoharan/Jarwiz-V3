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

/**
 * What Jarwiz mutters while it reads — honest work, funny delivery. Each
 * read opens with the plain truth ('reading…'), then cycles a shuffled set
 * themed to what landed. Kept short: the badge ellipsizes at 160px.
 */
const QUIPS: Record<IngestKind, string[]> = {
  link: [
    'clicking around…',
    'dodging cookie banners…',
    'judging the fonts…',
    'skimming the headlines…',
    'nodding thoughtfully…',
    'scrolling with intent…',
    'opening 14 tabs…',
  ],
  pdf: [
    'flipping pages…',
    'squinting at fine print…',
    'highlighting furiously…',
    'dog-earing pages…',
    'checking the appendix…',
    'adjusting reading glasses…',
    'mouthing the big words…',
  ],
  image: [
    'looking closely…',
    'admiring the pixels…',
    'tilting head…',
    'stepping back a bit…',
    'framing it with fingers…',
    'saying "hmm, composition"…',
  ],
};

/** A fresh reading script: truth first, then the quips in a new order. */
export function readingQuips(kind: IngestKind): string[] {
  const shuffled = QUIPS[kind]
    .map((quip) => ({ quip, key: Math.random() }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.quip);
  return ['reading…', ...shuffled];
}
