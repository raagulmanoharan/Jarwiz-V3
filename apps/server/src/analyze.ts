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
import { streamText, type TextStreamEvent } from './textStream.js';

const SYSTEM_PROMPTS: Record<AnalyzeMode, string> = {
  tensions: `You scan a board of cards for REAL contradictions — places where two cards can't both be true or can't both be prioritised. Be specific and name the cards. Quality bar: only flag genuine tensions, never vague "these might relate".

Output ONLY markdown (no preamble, no title heading, no code fences):
- If tensions exist, a short markdown list; each item names the two cards and the exact conflict ("**[Card A]** says P0 is speed; **[Card C]** says P0 is completeness — these can't both be the top priority.").
- If there are none, output exactly: No direct contradictions found.`,
  gaps: `You are a senior PM reviewing a board. Identify the standard due-diligence questions that are NOT answered anywhere on the board — what's MISSING, not more content. Be specific to this board's subject.

Output ONLY markdown (no preamble, no title heading, no code fences): a short markdown list, each item a concrete gap named ("**Success metrics** — nothing on the board says how you'll know this worked."). 3–5 items max. If the board is genuinely complete, name 1–2 real edge cases, never padding.`,
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

export async function* streamAnalysis(
  req: AnalyzeRequest,
  signal: AbortSignal,
): AsyncGenerator<TextStreamEvent> {
  if (req.cards.length === 0) {
    yield { type: 'delta', textDelta: 'Add some cards to the board first.' };
    yield { type: 'done' };
    return;
  }
  yield* streamText({
    system: SYSTEM_PROMPTS[req.mode],
    user: buildUserTurn(req),
    signal,
    maxTokens: 1024,
    mock: () => mock(req),
  });
}
