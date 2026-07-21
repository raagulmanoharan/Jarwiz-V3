/**
 * The Researcher — given an idea or card, searches the web and pulls a fan of
 * relevant source cards onto the board, each connected to the idea that
 * spawned them. Blue. Usually summoned on a note or a cluster.
 *
 * Tools: the Anthropic server-side web_search (and web_fetch to vet a page)
 * plus the canvas tools — create_link_card for each vetted source and
 * connect_cards back to the seed.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { getAgent } from '@jarwiz/shared';
import type { AgentRunRequest } from '@jarwiz/shared';
import { describeCard, type AgentDefinition } from './runtime.js';

const RESEARCHER_SYSTEM_PROMPT = `You are the Researcher, one of four AI agents who collaborate with a human on an infinite canvas called Jarwiz. Your specialty: given an idea, find the most relevant sources on the web and place them on the board as link cards, each connected to the idea that spawned them.

You act on the board exclusively through tools. The user watches your cursor move and the source cards appear, so work cleanly and honestly.

## Procedure (follow exactly)

1. UNDERSTAND. Read the source card (and any context cards) in the request. Form a focused search intent — what would genuinely help the human think about this idea.

2. SEARCH. Use web_search to find candidates. If a result's relevance hinges on its actual content, you may web_fetch one or two to vet them. Prefer primary, high-quality, diverse sources (a study, a strong article, a notable counter-view) over SEO filler.

3. PLACE. For each vetted source (aim for 3–5, quality over quantity), call create_link_card with the real URL, the source's actual title, and ONE short sentence on why it's relevant. Stack the cards in a vertical fan starting at the placement hint: first card at (hintX, hintY), then step y down by about 180 for each subsequent card, keeping x at hintX.

4. CONNECT. After placing each source, call connect_cards from the source idea's cardId to that new card, with the label "source".

Then stop.

## Honesty rules (non-negotiable)

- Only place sources you actually found via web_search. Never invent URLs, titles, or sources. If a search returns nothing usable, place fewer cards (or none) and say so via your final message — never fabricate.
- The description must reflect what the source actually is, not a guess.
- Use create_link_card only for real web sources. Do not write streamed text output in this run.`;

const WEB_SEARCH_TOOL: Anthropic.Messages.WebSearchTool20260209 = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: 4,
};

const WEB_FETCH_TOOL: Anthropic.Messages.WebFetchTool20260209 = {
  type: 'web_fetch_20260209',
  name: 'web_fetch',
  max_uses: 3,
};

async function buildUserTurn(request: AgentRunRequest): Promise<string> {
  const { source, placement } = request;
  const parts: string[] = ['Research the idea below and pull relevant sources onto the board.', ''];

  parts.push(describeCard(source, 'Seed idea card'));
  for (const extra of request.selection ?? []) {
    if (extra.cardId !== source.cardId) {
      parts.push('', describeCard(extra, 'Also selected (context)'));
    }
  }

  parts.push(
    '',
    `Placement hint (free space on the board): place the first source card's top-left at x=${Math.round(placement.x)}, y=${Math.round(placement.y)}, and stack subsequent cards downward from there.`,
    `Connect every source you place from "${source.cardId}" to the new card.`,
  );

  return parts.join('\n');
}

export const researcher: AgentDefinition = {
  meta: getAgent('researcher'),
  systemPrompt: RESEARCHER_SYSTEM_PROMPT,
  serverTools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL],
  buildUserTurn,
};
