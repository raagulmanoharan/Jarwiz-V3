/**
 * Analyze (Big Rocks 2.3 / 3.1 / 3.2 — give the agents opinions), now streamed.
 *
 * One generator, three lenses over the board (or a selection):
 *  - 'tensions' — name specific contradictions between cards (conflict detection)
 *  - 'gaps'     — what a senior PM would ask that isn't answered ("what am I missing?")
 *  - 'critique' — Devil's Advocate: weakest assumption, failure mode, likely objector
 *
 * Streams a markdown body token-by-token (the client owns the doc-card title,
 * which is deterministic by mode). Routes API → CLI sidecar → mock via streamText.
 */

import type { AnalyzeCard, AnalyzeMode, AnalyzeRequest } from '@jarwiz/shared';
import { extractAssetText, isValidAssetId } from './assets.js';
import { streamText, type TextStreamEvent } from './textStream.js';

/** Cost caps for PDFs joining a board scan: extracted TEXT only (never the
 *  raw document), at most this many documents, this much text each. Keeps a
 *  casual "Scan for tensions" bounded no matter how heavy the board is. */
const PDF_MAX_DOCS = 3;
const PDF_MAX_CHARS = 6_000;

const SYSTEM_PROMPTS: Record<AnalyzeMode, string> = {
  tensions: `You scan a board of cards for REAL contradictions — places where two cards can't both be true or can't both be prioritised. Be specific and name the cards. Quality bar: only flag genuine tensions, never vague "these might relate".

Output ONLY markdown (no title heading, no code fences). Start with ONE short plain sentence framing what you scanned (e.g. "Across the launch cards, two commitments pull against each other.") — a card that opens directly with a bullet reads broken. Then:
- If tensions exist, a short markdown list; each item names the two cards and the exact conflict ("**[Card A]** says P0 is speed; **[Card C]** says P0 is completeness — these can't both be the top priority.").
- If there are none, the sentence alone: No direct contradictions found.`,
  gaps: `You are a senior PM reviewing a board. Identify the standard due-diligence questions that are NOT answered anywhere on the board — what's MISSING, not more content. Be specific to this board's subject.

Output ONLY markdown (no title heading, no code fences). Start with ONE short plain sentence framing the review (e.g. "The board covers the launch plan well; a few questions are unanswered.") — a card that opens directly with a bullet reads broken. Then a short markdown list, each item a concrete gap named ("**Success metrics** — nothing on the board says how you'll know this worked."). 3–5 items max. If the board is genuinely complete, name 1–2 real edge cases, never padding.`,
  critique: `You are a Devil's Advocate. Given the cards, do exactly one thing: tear apart the thinking. Find (1) the weakest assumption, (2) the most likely failure mode, (3) the stakeholder most likely to object. Sharp, specific, no hedging, no solutions, no softening. End with a single pointed question.

Output ONLY markdown (no preamble, no title heading, no code fences): three short labelled sections (**Weakest assumption**, **Most likely failure**, **Who objects**), each 1–2 sentences naming specifics from the cards, then a final line with one question.`,
};

export function analyzeTitle(mode: AnalyzeMode): string {
  return mode === 'tensions' ? 'Tensions' : mode === 'gaps' ? "What's missing" : "Devil's advocate";
}

function formatCard(c: AnalyzeCard): string {
  const head = c.title ? `${c.kind}: "${c.title}"` : c.kind;
  return `[${head}]\n${c.text || '(empty)'}`;
}

function buildUserTurn(req: AnalyzeRequest): string {
  const list = req.cards.map(formatCard).join('\n\n');
  const verb =
    req.mode === 'tensions'
      ? 'Scan these cards for contradictions.'
      : req.mode === 'gaps'
        ? 'Review this board and name what is missing.'
        : 'Tear apart the thinking in these cards.';
  return `${verb}\n\nThe board:\n\n${list}`;
}

function mock(req: AnalyzeRequest): string {
  const n = req.cards.length;
  if (req.mode === 'tensions') return `Scanned ${n} cards (demo mode — set ANTHROPIC_API_KEY for a real scan).\n\n- No direct contradictions found.`;
  if (req.mode === 'gaps') return `Looking across ${n} cards (demo mode):\n\n- **Success metrics** — how will you know this worked?\n- **Rollback plan** — what happens if it goes wrong?\n- **Competitive response** — what do incumbents do next?`;
  return `(Demo mode — set ANTHROPIC_API_KEY for a real critique.)\n\n**Weakest assumption** — that these ${n} cards capture the real problem.\n\n**Most likely failure** — shipping before the riskiest assumption is tested.\n\n**Who objects** — the team that owns the surface this touches.\n\nWhat's the one piece of evidence that would change your mind?`;
}

/** Swap PDF references for their extracted text (capped), so documents are
 *  first-class scan material without document-block token costs. Unreadable
 *  or over-cap PDFs degrade to an honest note rather than vanishing. */
async function resolvePdfCards(cards: AnalyzeCard[]): Promise<AnalyzeCard[]> {
  let docs = 0;
  const out: AnalyzeCard[] = [];
  for (const card of cards) {
    if (card.kind !== 'pdf' || !card.assetId) {
      out.push(card);
      continue;
    }
    if (!isValidAssetId(card.assetId) || docs >= PDF_MAX_DOCS) {
      out.push({ kind: 'pdf', title: card.title, text: '(document present on the board, not included in this scan)' });
      continue;
    }
    docs += 1;
    const extracted = await extractAssetText(card.assetId, PDF_MAX_CHARS);
    out.push({
      kind: 'pdf',
      title: card.title,
      text: extracted?.text
        ? `(document excerpt, ${extracted.pages} pages)\n${extracted.text}`
        : '(document could not be read)',
    });
  }
  return out;
}

export async function* streamAnalysis(
  req: AnalyzeRequest,
  signal: AbortSignal,
): AsyncGenerator<TextStreamEvent> {
  if (req.cards.length === 0) {
    yield { type: 'delta', textDelta: 'Add some cards to the board first.' };
    yield { type: 'done' };
    return;
  }
  const resolved: AnalyzeRequest = { ...req, cards: await resolvePdfCards(req.cards) };
  yield* streamText({
    system: SYSTEM_PROMPTS[resolved.mode],
    user: buildUserTurn(resolved),
    signal,
    maxTokens: 1024,
    mock: () => mock(resolved),
  });
}
