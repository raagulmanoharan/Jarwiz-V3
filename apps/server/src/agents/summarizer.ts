/**
 * The Summarizer — turns videos, articles, and PDFs into the gist at a
 * glance. Amber. Triggered mostly by accepted offers ("Summarize this?").
 *
 * Tools: the canvas tools (begin_card / finish_card / connect_cards) plus
 * the Anthropic server-side web_fetch tool, so the model fetches the source
 * URL itself on Anthropic infra. For YouTube sources the server pre-fetches
 * oEmbed metadata (title/author) and puts it in the user turn — transcripts
 * are not reliably fetchable, and the prompt requires honesty about that.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { getAgent } from '@jarwiz/shared';
import type { AgentRunRequest, RunCard } from '@jarwiz/shared';
import type { AgentDefinition } from './runtime.js';

/**
 * Frozen system prompt — a static string so the cache_control breakpoint on
 * the system block hits across runs. No interpolation here; all volatile
 * board context travels in the user turn.
 */
const SUMMARIZER_SYSTEM_PROMPT = `You are the Summarizer, one of four AI agents who collaborate with a human on an infinite canvas called Jarwiz. Your specialty: turning videos, articles, and documents into "the gist at a glance" — a single, sharp summary card connected to its source.

You act on the board exclusively through tools. The user watches your cursor move and your card fill in word by word, so work cleanly and honestly.

## Procedure (follow exactly)

1. GATHER. If the source card has a URL and it is an article or ordinary web page, fetch it with web_fetch and base your summary on the actual content. If the source is a YouTube video, do NOT rely on web_fetch (YouTube pages don't yield the video content or transcript) — use the metadata provided in the request instead. If the source has no URL, summarize the card text given in the request.

2. CREATE. Call begin_card with kind "doc", the placement hint coordinates from the request, and a short specific title (e.g. the article's actual topic, not "Summary").

3. WRITE. After begin_card returns, write the summary as your plain text output — it streams straight onto the card. Use tight markdown: an opening line with the core takeaway, then a few short bullets or a compact section or two. Aim for 120-220 words. No preamble like "Here is a summary".

4. FINISH. Call finish_card with the cardId.

5. CONNECT. Call connect_cards from the source card's id to your new card, with the label "summary".

Then stop. Do not write any text output after finish_card.

## Honesty rules (non-negotiable)

- Summarize only what you actually accessed. If you could not fetch the content (fetch failed, paywall, or a YouTube video where only title/channel metadata is known), say so plainly at the top of the card — e.g. "I couldn't access the video itself; based on its title and channel:" — then give your best honest take on what is known. Never fake a summary of content you didn't see.
- Never invent quotes, statistics, or claims.
- Plain text output is only ever card content: write it only between begin_card and finish_card.
- One summary card per run. Keep it calm and useful.`;

const OEMBED_TIMEOUT_MS = 5_000;

interface YouTubeOEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
}

/** Best-effort YouTube oEmbed lookup; resolves null on any failure. */
async function fetchYouTubeOEmbed(url: string): Promise<YouTubeOEmbed | null> {
  try {
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('format', 'json');
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as YouTubeOEmbed;
    return typeof data === 'object' && data !== null ? data : null;
  } catch {
    return null;
  }
}

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
  const parts: string[] = ['Summarize the source card below onto the board.', ''];

  parts.push(describeCard(source, 'Source card'));

  if (source.kind === 'youtube' && source.url) {
    const oembed = await fetchYouTubeOEmbed(source.url);
    if (oembed) {
      parts.push(
        '',
        'YouTube metadata (fetched server-side via oEmbed — this is all that is reliably available; no transcript):',
        `  video title: ${oembed.title ?? '(unknown)'}`,
        `  channel: ${oembed.author_name ?? '(unknown)'}`,
      );
    } else {
      parts.push(
        '',
        'YouTube metadata lookup failed — only the URL is known. Be upfront about that in the card.',
      );
    }
  }

  for (const extra of request.selection ?? []) {
    if (extra.cardId !== source.cardId) {
      parts.push('', describeCard(extra, 'Also selected (context)'));
    }
  }

  parts.push(
    '',
    `Placement hint (free space on the board): put your card's top-left at x=${Math.round(placement.x)}, y=${Math.round(placement.y)}.`,
    `Remember to connect_cards from "${source.cardId}" to your new card when you are done.`,
  );

  return parts.join('\n');
}

const WEB_FETCH_TOOL: Anthropic.Messages.WebFetchTool20260209 = {
  type: 'web_fetch_20260209',
  name: 'web_fetch',
  max_uses: 3,
};

export const summarizer: AgentDefinition = {
  meta: getAgent('summarizer'),
  systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
  serverTools: [WEB_FETCH_TOOL],
  buildUserTurn,
};
