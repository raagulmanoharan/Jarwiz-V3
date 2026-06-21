/**
 * Analyze (Big Rocks 2.3 / 3.1 / 3.2 — give the agents opinions).
 *
 * One generator, three lenses over the board (or a selection):
 *  - 'tensions' — name specific contradictions between cards (conflict detection)
 *  - 'gaps'     — what a senior PM would ask that isn't answered ("what am I missing?")
 *  - 'critique' — Devil's Advocate: weakest assumption, failure mode, likely objector
 *
 * Each returns a single doc card { title, text }. Routes API → CLI sidecar → a
 * scripted mock, so it's demoable with no key.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AnalyzeCard, AnalyzeMode, AnalyzeRequest, AnalyzeResult } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';

const SYSTEM_PROMPTS: Record<AnalyzeMode, string> = {
  tensions: `You scan a board of cards for REAL contradictions — places where two cards can't both be true or can't both be prioritised. Be specific and name the cards. Quality bar: only flag genuine tensions, never vague "these might relate". If there are none, say so plainly.

Return ONLY a JSON object: {"title":"Tensions","text":"markdown"}.
- text: if tensions exist, a short markdown list, each item naming the two cards and the exact conflict ("**[Card A]** says P0 is speed; **[Card C]** says P0 is completeness — these can't both be the top priority."). If none, exactly: "No direct contradictions found." (and nothing else).
- No preamble, no code fences.`,
  gaps: `You are a senior PM reviewing a board. Identify the standard due-diligence questions that are NOT answered anywhere on the board — what's MISSING, not more content. Be specific to this board's subject.

Return ONLY a JSON object: {"title":"What's missing","text":"markdown"}.
- text: a short markdown list, each item a concrete gap named ("**Success metrics** — nothing on the board says how you'll know this worked."). 3–5 items max. If the board is genuinely complete, name 1–2 real edge cases, never padding.
- No preamble, no code fences.`,
  critique: `You are a Devil's Advocate. Given the cards, do exactly one thing: tear apart the thinking. Find (1) the weakest assumption, (2) the most likely failure mode, (3) the stakeholder most likely to object. Sharp, specific, no hedging, no solutions, no softening. End with a single pointed question.

Return ONLY a JSON object: {"title":"Devil's advocate","text":"markdown"}.
- text: three short labelled sections (**Weakest assumption**, **Most likely failure**, **Who objects**), each 1–2 sentences naming specifics from the cards, then a final line with one question.
- No preamble, no code fences.`,
};

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

function parseResult(raw: string, mode: AnalyzeMode): AnalyzeResult {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(text) as { title?: unknown; text?: unknown };
  const body = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (!body) throw new Error('empty analysis');
  const fallbackTitle =
    mode === 'tensions' ? 'Tensions' : mode === 'gaps' ? "What's missing" : "Devil's advocate";
  const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallbackTitle;
  return { title, text: body };
}

function mockResult(req: AnalyzeRequest): AnalyzeResult {
  const n = req.cards.length;
  if (req.mode === 'tensions') {
    return {
      title: 'Tensions',
      text: `Scanned ${n} cards. (Demo mode: set ANTHROPIC_API_KEY for a real scan.)\n\n- No direct contradictions found.`,
    };
  }
  if (req.mode === 'gaps') {
    return {
      title: "What's missing",
      text: `Looking across ${n} cards (demo mode — set ANTHROPIC_API_KEY for a real review):\n\n- **Success metrics** — how will you know this worked?\n- **Rollback plan** — what happens if it goes wrong?\n- **Competitive response** — what do incumbents do next?`,
    };
  }
  return {
    title: "Devil's advocate",
    text: `(Demo mode — set ANTHROPIC_API_KEY for a real critique.)\n\n**Weakest assumption** — that the ${n} cards here capture the real problem.\n\n**Most likely failure** — shipping before the riskiest assumption is tested.\n\n**Who objects** — the team that owns the surface this touches.\n\nWhat's the one piece of evidence that would change your mind?`,
  };
}

export async function generateAnalysis(
  req: AnalyzeRequest,
  signal: AbortSignal,
): Promise<AnalyzeResult> {
  if (req.cards.length === 0) {
    return { title: 'Nothing to analyze', text: 'Add some cards to the board first.' };
  }
  const system = SYSTEM_PROMPTS[req.mode];
  const user = buildUserTurn(req);

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  if (hasKey) {
    const client = new Anthropic();
    const message = await client.messages.create(
      {
        model: AGENT_MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
      },
      { signal },
    );
    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return parseResult(text, req.mode);
  }

  if (sidecarAvailable()) {
    try {
      const text = await sidecarGenerate({ system, user, signal });
      return parseResult(text, req.mode);
    } catch {
      if (signal.aborted) throw new Error('aborted');
    }
  }
  return mockResult(req);
}
