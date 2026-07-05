/**
 * Live web access — asks and table fills hand the model Anthropic's server
 * tools (web_search / web_fetch) so answers can use today's facts: prices,
 * availability, reviews, versions. The model decides when to reach out (an
 * unused tool costs nothing); the directives below keep searches purposeful
 * and every web-sourced claim cited as a real markdown link. The keyless dev
 * path mirrors this with the Claude CLI's own WebSearch/WebFetch (sidecar.ts).
 */

import type Anthropic from '@anthropic-ai/sdk';

/** Server-tool declarations for one generation — capped uses bound cost. */
export function webToolset(): Anthropic.Messages.ToolUnion[] {
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4 },
  ];
}

/** Deep research gets a real leash: enough searches to cover reviews, prices,
 *  reputation, and alternatives as separate angles, plus page fetches. */
export function researchToolset(): Anthropic.Messages.ToolUnion[] {
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 10 },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 },
  ];
}

/** Server tools may pause a long turn (`stop_reason: "pause_turn"`); resume by
 *  replaying the assistant content. This caps how many times we do. */
export const WEB_MAX_CONTINUATIONS = 6;

/** A research pass legitimately pauses more often — many tool rounds. */
export const RESEARCH_MAX_CONTINUATIONS = 12;

/** Appended to the prose/list systems when the web is on. */
export const WEB_DIRECTIVE = `

You can reach the live web: web_search finds current pages, web_fetch reads one URL in full. Use them when the ask needs current or external facts — prices, availability, reviews, ratings, versions, news, anything "latest" — or when a web-page source's extract above is too thin to answer from (fetch its URL to read the full page, e.g. a hotel or listing page whose reviews matter). When the board's sources already hold the answer, don't search. Do ALL searching and fetching first, then write the card once — never narrate tool use ("let me search…") in the card text. Every claim that came from the web cites its page as a markdown link: inline as ([source](URL)) where a specific claim needs one, and one closing "Source: [Title](URL)" line per page used. Use each page's real URL — never invent one.`;

/** Appended to the table-answer system when the web is on. */
export const WEB_TABLE_DIRECTIVE = `

You can reach the live web: web_search finds current pages, web_fetch reads one URL in full. Use them when the grid needs current facts (prices, availability, reviews, ratings) or when a source URL's extract is too thin — fetch it. Finish ALL searching before emitting the JSON, and still return ONLY the JSON object — no prose before, between, or after tool calls. A web-sourced cell may cite its page as [label](url) with the page's real URL.`;

/** Appended to the table cell-fill system when the web is on. */
export const WEB_FILL_DIRECTIVE = `

You can reach the live web (web_search / web_fetch). Use it when a column wants real-world current values — prices, rates, ratings, hours, distances — and fill cells with what you actually find. Search first; then return ONLY the JSON object.`;
