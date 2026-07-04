/**
 * Drop-moment profile offer (docs/PDF-EDGE.md build 3) — the first five
 * seconds after a PDF lands. Ingestion registers an offer when the upload
 * completes; ProfileOfferLayer renders it as a quiet chip under the card.
 * Accepting runs the ordinary Ask pipeline with the profile prompt below, so
 * the result is a normal streamed doc card with a provenance edge and
 * Keep/Discard — nothing bespoke to maintain.
 *
 * Offered, never forced: one chip at a time (a newer drop replaces it), ✕ or
 * running it remembers the asset so the same document never re-offers, and
 * deleting the card clears it. The durable path lives in the card's Refine
 * menu; this chip is only the drop-moment shortcut.
 */

import type { TLShapeId } from 'tldraw';

/** The one-glance profile ask. Shared with the Refine menu so both paths
 *  produce the same card. Structure over prose: scannable in ten seconds. */
export const PROFILE_PROMPT = [
  'Give me a one-glance profile of this document — compact, scannable in ten seconds.',
  'Start with a \'# Profile — <short document name>\' title line.',
  'Then short markdown sections with bold labels, no preamble:',
  '**What this is** — the document type and a one-line gist.',
  "**Who's behind it** — authors or parties and their roles.",
  '**Key dates** — only the ones that matter.',
  "**Red flags** — anything unusual, risky, or conspicuously missing; say 'none apparent' honestly if so.",
  '**Start here** — the one section to read first, and why.',
  'End with the three questions most worth asking this document, as a short list.',
].join('\n');

export interface ProfileOffer {
  cardId: TLShapeId;
  assetId: string;
  name: string;
}

const SEEN_KEY = 'jz-profile-seen-v1';
const SEEN_CAP = 300;

let _offer: ProfileOffer | null = null;
const _listeners = new Set<() => void>();

function emit(): void {
  _listeners.forEach((cb) => cb());
}

function seen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function remember(assetId: string): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen(), assetId].slice(-SEEN_CAP)));
  } catch {
    /* storage full / private mode — the offer just re-appears next session */
  }
}

export function subscribeProfileOffer(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export function getProfileOffer(): ProfileOffer | null {
  return _offer;
}

/** Called by ingestion when a dropped PDF finishes uploading. */
export function offerProfile(offer: ProfileOffer): void {
  if (seen().includes(offer.assetId)) return; // this document was already offered
  _offer = offer;
  emit();
}

/** Clear the chip. `rememberAsset` marks the document as handled (✕ or run);
 *  false is for housekeeping (card deleted) where re-offering is fine. */
export function dismissProfileOffer(rememberAsset = true): void {
  if (!_offer) return;
  if (rememberAsset) remember(_offer.assetId);
  _offer = null;
  emit();
}
