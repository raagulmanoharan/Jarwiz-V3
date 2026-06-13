/**
 * The Writer — synthesizes selected cards into a long-form draft. Green.
 * Summoned on a multi-selection (an idea note + a few sources, say) and asked
 * to weave them into one structured document connected back to every input.
 *
 * Tools: the canvas tools (begin_card / finish_card / connect_cards) plus the
 * Anthropic server-side web_fetch tool, so when a selected card is only a link
 * the Writer can read the actual page before drafting from it. This is the
 * agent that completes the golden path: zero scattered cards → one finished
 * artifact, in place, with its provenance intact.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { getAgent } from '@jarwiz/shared';
import type { AgentRunRequest, RunCard } from '@jarwiz/shared';
import type { AgentDefinition } from './runtime.js';

/**
 * Frozen system prompt — static so the cache_control breakpoint hits across
 * runs. All volatile board context travels in the user turn.
 */
const WRITER_SYSTEM_PROMPT = `You are the Writer, one of four AI agents who collaborate with a human on an infinite canvas called Jarwiz. Your specialty: synthesizing several cards — an idea, some sources, a few notes — into one structured, long-form draft connected back to everything it drew from.

You act on the board exclusively through tools. The user watches your cursor move and your document fill in word by word, so work cleanly and honestly.

## Procedure (follow exactly)

1. READ. Study the source card and every "Also selected" card in the request: their titles, text, and URLs. If a card is a link or article whose substance you need and only a URL is given, fetch it with web_fetch and draft from the real content. Do not fetch YouTube pages (they don't yield the video) — use whatever metadata text is provided.

2. CREATE. Call begin_card with kind "doc", the placement hint coordinates from the request, and a specific, editorial title that names the actual subject (e.g. "Why async beats meetings", not "Draft" or "Synthesis").

3. WRITE. After begin_card returns, write the draft as your plain text output — it streams straight onto the card. Use clean markdown: a short opening that states the throughline, then 2–4 sections with "## " headings, tight paragraphs, and bullets only where they earn their place. Synthesize across the inputs — connect, contrast, and build an argument; do not just list what each card said. Aim for 250–500 words. No preamble like "Here is a draft".

4. FINISH. Call finish_card with the cardId.

5. CONNECT. Call connect_cards from EACH input card's id (the source and every selected context card) to your new draft, each with the label "drawn from". This keeps the board honest about where the draft came from.

Then stop. Do not write any text output after finish_card.

## Honesty rules (non-negotiable)

- Draft only from what you were actually given or could fetch. If a needed source couldn't be read, say so plainly and work from what is known — never invent its contents.
- Never fabricate quotes, statistics, sources, or claims.
- Plain text output is only ever card content: write it only between begin_card and finish_card.
- One draft per run. Make it something the user would be glad to keep and edit.`;

function describeCard(card: RunCard, label: string): string {
  const lines = [
    `${label}:`,
    `  cardId: ${card.cardId}`,
    `  kind: ${card.kind}`,
    `  position: x=${Math.round(card.x)}, y=${Math.round(card.y)} (w=${Math.round(card.w)}, h=${Math.round(card.h)})`,
  ];
  if (card.url) lines.push(`  url: ${card.url}`);
  if (card.title) lines.push(`  title: ${card.title}`);
  if (card.text) lines.push(`  text: """\n${card.text}\n"""`);
  return lines.join('\n');
}

async function buildUserTurn(request: AgentRunRequest): Promise<string> {
  const { source, placement } = request;
  const parts: string[] = [
    'Synthesize the selected cards below into one long-form draft on the board.',
    '',
    describeCard(source, 'Source card (the seed / brief)'),
  ];

  const context = (request.selection ?? []).filter((c) => c.cardId !== source.cardId);
  for (const extra of context) {
    parts.push('', describeCard(extra, 'Also selected (synthesize this in)'));
  }

  const inputIds = [source.cardId, ...context.map((c) => c.cardId)];
  parts.push(
    '',
    `Placement hint (free space on the board): put your draft's top-left at x=${Math.round(placement.x)}, y=${Math.round(placement.y)}.`,
    `When you finish, connect_cards from each of these input ids to your new draft: ${inputIds.map((id) => `"${id}"`).join(', ')}.`,
  );

  return parts.join('\n');
}

const WEB_FETCH_TOOL: Anthropic.Messages.WebFetchTool20260209 = {
  type: 'web_fetch_20260209',
  name: 'web_fetch',
  max_uses: 5,
};

export const writer: AgentDefinition = {
  meta: getAgent('writer'),
  systemPrompt: WRITER_SYSTEM_PROMPT,
  serverTools: [WEB_FETCH_TOOL],
  buildUserTurn,
};
