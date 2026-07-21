/**
 * Notice — proactive comments. Read the board and, like a sharp collaborator
 * glancing over your shoulder, leave a SHORT comment pinned to a specific card
 * when something is genuinely worth flagging: a contradiction, a real risk, a
 * timing/season issue (that's why we pass today's date), or a missing piece.
 *
 * The bar is high on purpose. A board that's fine gets ZERO comments — an empty
 * result is the correct, common answer. Better to say nothing than to nag.
 * Each comment must pin to one of the card ids we sent, so the UI can anchor it.
 */

import type { NoticeCard, NoticeComment, NoticeKind, NoticeRequest } from '@jarwiz/shared';
import { generateText } from './generate.js';
import { parseJsonArray } from './util.js';

const MAX_CARDS = 24;
const MAX_TEXT_PER_CARD = 900;
const MAX_COMMENTS = 3;
const MAX_TOKENS = 1200;
const SIDECAR_TIMEOUT_MS = 90_000;

const KINDS: NoticeKind[] = ['risk', 'tension', 'gap', 'idea'];

const SYSTEM = `You are Jarwiz, quietly reviewing a collaborator's canvas the way a sharp teammate glances over their shoulder. You leave SHORT comments pinned to specific cards — only when something is genuinely worth saying.

Leave a comment ONLY for something that materially helps: a real contradiction between cards, a concrete risk or blind spot, a timing/season/date problem (you're given today's date — use it), or an important missing piece. If the board is fine, say nothing — returning an EMPTY list is the correct and common answer. Never comment just to comment, never restate what a card already says, never praise.

Voice: a helpful colleague, first person, warm and direct. One or two tight sentences. Name the specific thing. Good: "Heads up — your dates land in Goa's monsoon window, so the beach-and-water-sports plan probably won't hold. Want me to rework it for a rainy-season weekend?" Bad: "Consider the weather."

Return ONLY a JSON array (no prose, no code fences) of AT MOST ${MAX_COMMENTS} objects, most important first:
{"cardId": string (EXACTLY one of the card ids given — the card the comment is about), "kind": "risk"|"tension"|"gap"|"idea", "body": string (the comment, 1–2 sentences, first person), "suggestion": string (optional — a short instruction you'd run on that card to address it, phrased as the user asking you, e.g. "Rework this itinerary for monsoon season")}

If nothing is worth flagging, return []. Quality over quantity — zero good comments beats three weak ones.`;

/** Compact the board into an id-tagged list the model can point back at. */
function boardSummary(cards: NoticeCard[]): string {
  return cards
    .slice(0, MAX_CARDS)
    .map((c) => {
      const label = c.title ? `${c.kind}: ${c.title}` : c.kind;
      const body = (c.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_PER_CARD);
      return `id=${c.id} [${label}]${body ? ` — ${body}` : ''}`;
    })
    .join('\n');
}

function review(user: string, signal: AbortSignal): Promise<string> {
  return generateText({ system: SYSTEM, user, signal, maxTokens: MAX_TOKENS, sidecarTimeoutMs: SIDECAR_TIMEOUT_MS });
}

/** Tolerant JSON-array parse — replies sometimes wrap it in prose/fences. */
/**
 * Review a board and return proactive comments, each pinned to a real card id.
 * Defensive: drops anything not pinned to a card we sent, dedupes per card, and
 * caps the list — a stray or repeated comment can't clutter the canvas.
 */
export async function reviewBoard(req: NoticeRequest, signal: AbortSignal): Promise<NoticeComment[]> {
  const cards = Array.isArray(req.cards) ? req.cards : [];
  if (cards.length === 0) return [];
  const ids = new Set(cards.map((c) => c.id));
  const today = req.today ? `Today's date is ${req.today}.\n\n` : '';
  const user = `${today}The board has these cards (pin any comment to one of these ids):\n${boardSummary(cards)}\n\nReview it and return proactive comments as JSON — or [] if nothing is worth flagging.`;

  let raw: string;
  try {
    raw = await review(user, signal);
  } catch {
    return [];
  }
  if (signal.aborted) return [];

  const out: NoticeComment[] = [];
  const usedCards = new Set<string>();
  for (const item of parseJsonArray(raw)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const cardId = String(o.cardId ?? '').trim();
    if (!ids.has(cardId) || usedCards.has(cardId)) continue; // must pin to a real, not-yet-used card
    const body = String(o.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 280);
    if (!body) continue;
    const kind = KINDS.includes(o.kind as NoticeKind) ? (o.kind as NoticeKind) : 'idea';
    const suggestion = String(o.suggestion ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || undefined;
    usedCards.add(cardId);
    out.push({ cardId, kind, body, suggestion });
    if (out.length >= MAX_COMMENTS) break;
  }
  return out;
}
