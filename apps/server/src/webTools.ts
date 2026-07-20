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

You can reach the live web: web_search finds current pages, web_fetch reads one URL in full. PREFER to use them. Whenever the answer rests on specific real-world facts — names, dates, works, filmographies, discographies, credits, people, companies, places, products, prices, specs, statistics, versions, standings, anything current or externally verifiable — run a quick web_search FIRST and ground the answer in what you find, rather than answering from memory. A confident guess that's stale, incomplete, or wrong misleads the user; a short verification search is almost always worth it. Also fetch a web-page source's URL when its extract above is too thin to answer from (listings, products, articles, docs alike). Only skip the web when the ask is genuinely timeless reasoning that no source would improve — an explanation of a concept, a how-to, an opinion, brainstorming, creative writing, pure analysis of the attached sources — or when the board's sources already hold the answer. Do ALL searching and fetching first, then write the card once — never narrate tool use ("let me search…") in the card text. Every claim that came from the web cites its page as a markdown link: inline as ([source](URL)) where a specific claim needs one, and one closing "Source: [Title](URL)" line per page used. Use each page's real URL — never invent one.

IMAGES — use them for VISUAL answers, don't be shy. When the answer centres on visual things — places, products, buildings, artworks, devices, people, dishes, animals, cars — real images genuinely lift the card, so ADD them:
- Inline (![alt](url)) for a single subject or a short highlight — right where you name it.
- As a leading "Image" column (each cell exactly ![name](url)) when the answer is a TABLE of visual things — one image per row. Put the image column FIRST.
Get every image with the find_image tool (ONE short concrete query per subject, e.g. "Lake Bled", "Aeron chair") or from a page you fetched, and embed the returned URL VERBATIM. Only skip images for genuinely non-visual answers — analysis, code, how-tos, abstract reasoning, pure text. Never invent, guess, or alter an image URL; if find_image returns nothing for a subject, leave that image out (or the cell empty) — never a broken frame, never a made-up link.`;

/** Appended to the table-answer system when the web is on. */
export const WEB_TABLE_DIRECTIVE = `

You can reach the live web: web_search finds current pages, web_fetch reads one URL in full. PREFER to use them. When the grid is about real-world things — products, films, people, places, companies, specs, prices, ratings, statistics, anything externally verifiable — search FIRST and fill the cells from what you find rather than from memory (a comparison built on stale or half-remembered facts misleads). Also fetch a source URL when its extract is too thin. Only skip the web when the table is purely reasoning over the attached sources. Finish ALL searching before emitting the JSON, and still return ONLY the JSON object — no prose before, between, or after tool calls. A web-sourced cell may cite its page as [label](url) with the page's real URL.

IMAGES: when the rows are VISUAL things — products, places, buildings, vehicles, artworks, devices, people — add an "Image" column as the FIRST column, each cell exactly ![name](url), one image per row. Get the URLs with the find_image tool (one short concrete query per row item, e.g. "Aeron chair") or from a page you fetched; use returned URLs VERBATIM and never invent, guess, or alter an image URL. If find_image is not among your tools, you may fetch https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=ITEM&gsrlimit=2&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=400 and use a "thumburl" from the response. Leave a row's image cell empty when nothing came back, and skip the column entirely when rows aren't visual (metrics, dates, policies, clauses).`;

/** Appended to the table cell-fill system when the web is on. */
export const WEB_FILL_DIRECTIVE = `

You can reach the live web (web_search / web_fetch). Use it when a column wants real-world current values — prices, rates, ratings, hours, distances — and fill cells with what you actually find. Search first; then return ONLY the JSON object.`;
