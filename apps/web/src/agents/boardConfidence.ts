/**
 * Scout readiness — turn the board into a confidence score (0→1) that answers
 * one question: "is there a cohesive, substantial thread here worth scouting?"
 *
 * This replaces the old raw ≥3-card gate, which was a weak proxy: three empty,
 * thin, or unrelated cards shouldn't unlock Scout; three rich cards on one
 * topic should. It runs client-side on every board change (cheap, no model
 * call) and drives the progress fill, so the meter reflects Jarwiz's actual
 * confidence rather than a headcount.
 *
 * Two signals, MULTIPLIED so a board must have both to score high:
 *  - substance: how much real content is on the board. Thin stubs barely count;
 *    a referenced document (PDF/sheet) counts as a whole file.
 *  - cohesion:  do the cards share a topic? Measured by term overlap — a card
 *    with no words in common with the rest drags cohesion down, so a scattered
 *    board caps out well below the activation line no matter how much you add.
 *
 * The constants below are a tuned first pass; they're the knobs to adjust as we
 * watch it against real boards.
 */

import type { AnalyzeCard } from '@jarwiz/shared';

const SUBSTANCE_TARGET = 3; // weighted "solid cards" that add up to full substance
const SUBSTANTIAL_WORDS = 25; // words for a single card to count as fully substantial
const COHESION_FLOOR = 0.35; // an incoherent board can't exceed this share of its substance
const ACTIVATE = 0.7; // confidence at which Scout unlocks — mapped to a full (100%) fill

export interface ScoutReadiness {
  /** The honest 0→1 score. */
  confidence: number;
  /** 0→1 fill for the meter (confidence / ACTIVATE, clamped); 1 === unlocked. */
  progress: number;
  /** confidence has reached the activation line. */
  active: boolean;
  /** One-line "why it isn't full yet", for the button tooltip. */
  reason: string;
}

// Compact English stop-word list — enough to keep cohesion measuring *topic*
// words, not grammar. Not exhaustive by design; the signal is robust to a few
// leaks either way.
const STOPWORDS = new Set(
  `the a an and or but if then else for from into over under with without within about above below of to in on at by as is are was were be been being it its this that these those they them their there here what which who whom whose when where why how all any both each few more most other some such no nor not only own same so than too very can will just don should now i you he she we me my your our his her they'll you're i'm we're have has had do does did done make made get got go goes going use used using want need like also then thing things one two three new`
    .split(/\s+/),
);

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Topic terms in a blob: lowercase words ≥3 chars that aren't stop-words. */
function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** How substantial a single card is, 0→1. */
function cardSubstance(card: AnalyzeCard): number {
  // A PDF/sheet joins the scan by reference — its inline text is empty but it
  // carries a whole document, so count it as fully substantial.
  if ((card.kind === 'pdf' || card.kind === 'sheet') && card.assetId) return 1;
  const body = `${card.title ?? ''} ${card.text}`.trim();
  const words = body ? body.split(/\s+/).length : 0;
  return clamp01(words / SUBSTANTIAL_WORDS);
}

/**
 * Do the cards hang together? 0 (unrelated) → 1 (tight single topic). Built from
 * per-card term SETS (presence, not frequency, so one long card can't dominate):
 * a term shared by ≥2 cards is a "link"; a card sharing no term with the rest is
 * off-topic and pulls the score down.
 */
function cohesion(cards: AnalyzeCard[]): number {
  const sets = cards
    .map((c) => new Set(terms(`${c.title ?? ''} ${c.text}`)))
    .filter((s) => s.size > 0);
  if (sets.length < 2) return 0.4; // can't read a "collection" from a single card

  const df = new Map<string, number>(); // document frequency: term → #cards containing it
  for (const s of sets) for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);

  const shared = new Set([...df].filter(([, n]) => n >= 2).map(([t]) => t));
  if (shared.size === 0) return 0; // nothing links the cards at all

  const linked = sets.filter((s) => [...s].some((t) => shared.has(t))).length;
  const connectivity = linked / sets.length; // share of cards tied into the thread
  const vocabOverlap = shared.size / df.size; // how concentrated the vocabulary is
  return clamp01(0.6 * connectivity + 0.4 * clamp01(vocabOverlap * 4));
}

/** Score the board for Scout. Pass the same cards Scout would send to discover. */
export function scoutReadiness(cards: AnalyzeCard[]): ScoutReadiness {
  const substance = cards.reduce((sum, c) => sum + cardSubstance(c), 0);
  const substanceProgress = clamp01(substance / SUBSTANCE_TARGET);
  const c = cohesion(cards);

  const confidence = substanceProgress * (COHESION_FLOOR + (1 - COHESION_FLOOR) * c);
  const progress = clamp01(confidence / ACTIVATE);
  const active = confidence >= ACTIVATE;

  let reason = '';
  if (!active) {
    if (cards.length === 0) reason = 'Add a few cards and Scout will look for a thread to research.';
    else if (substanceProgress < 0.5) reason = 'Add more substance — a few fuller cards — to unlock Scout.';
    else if (c < 0.4) reason = 'Your cards are a bit scattered — add ones that build on the same topic to unlock Scout.';
    else reason = 'Almost there — a little more on this topic and Scout unlocks.';
  }

  return { confidence, progress, active, reason };
}
