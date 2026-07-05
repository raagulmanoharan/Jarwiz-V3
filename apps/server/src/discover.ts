/**
 * Ultra Think — grounded resource discovery. Read the board, then use Claude's
 * live web search to surface REAL related resources (videos, papers, docs,
 * articles, repos). Grounding is the whole point: an ungrounded model invents
 * dead arxiv IDs and 404 YouTube links, and one dead link kills the promise.
 * So the model searches, and this module then VALIDATES (http(s) only) and
 * DEDUPES (against the board and within the results) before returning anything.
 *
 * This is the Claude/monorepo re-implementation of the feature PR #4 built on
 * the old flat Gemini scaffold — same idea, our engine (webTools.ts).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AnalyzeCard, DiscoverRequest, ResourceKind, SuggestedResource } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';
import { WEB_MAX_CONTINUATIONS, webToolset } from './webTools.js';

const MAX_CARDS = 24;
const MAX_TEXT_PER_CARD = 600;
const MAX_RESULTS = 8;
const MAX_TOKENS = 2000;

const KINDS: ResourceKind[] = ['video', 'article', 'paper', 'doc', 'repo', 'other'];

const SYSTEM = `You are Ultra Think, a discovery engine on an infinite canvas. You are given a summary of what the user has collected on their board. Your job: find REAL, high-quality resources from the live web that genuinely extend this collection — the things a sharp researcher would send them next.

Use web_search to FIND real pages; never invent a URL. Prefer primary sources and strong signal: the actual paper (not a blog about it), the official docs, the canonical video, a well-regarded article, the real repo. Diversity of kind and source is good — don't return five links from one site. Every suggestion must be clearly ANCHORED to something on the board (name what).

Return ONLY a JSON array (no prose, no code fences) of up to ${MAX_RESULTS} objects:
{"title": string, "description": string (one tight sentence on what it is), "url": string (the real, complete http(s) URL you found), "kind": one of "video"|"article"|"paper"|"doc"|"repo"|"other", "reason": string (start with "because you saved …" or "extends your …" — name the board item it connects to), "source": string (the site name, e.g. "arxiv.org")}

Rules: only URLs you actually found via search; no duplicates; no links to sites that require login. If you can't find good matches, return a shorter array (even []). Quality over quantity.`;

/** Compact the board into a prompt the model can reason over. */
function boardSummary(cards: AnalyzeCard[]): string {
  return cards
    .slice(0, MAX_CARDS)
    .map((c, i) => {
      const label = c.title ? `${c.kind}: ${c.title}` : c.kind;
      const body = (c.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_PER_CARD);
      return `${i + 1}. [${label}]${body ? ` — ${body}` : ''}`;
    })
    .join('\n');
}

/** Grounded generation with the web tools; returns the model's raw text. */
async function groundedSearch(user: string, signal: AbortSignal): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    const client = new Anthropic();
    const tools = webToolset();
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
    let text = '';
    for (let turn = 0; turn <= WEB_MAX_CONTINUATIONS; turn++) {
      const msg = await client.messages.create(
        { model: AGENT_MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, messages, tools },
        { signal },
      );
      text += msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (msg.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: msg.content });
    }
    return text;
  }
  if (sidecarAvailable()) {
    return sidecarGenerate({ system: SYSTEM, user, signal, web: true, timeoutMs: 180_000 });
  }
  throw new Error('No model available (set ANTHROPIC_API_KEY or install the Claude CLI).');
}

/** Tolerant JSON-array parse — grounded replies sometimes wrap it in prose. */
function parseResources(raw: string): unknown[] {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normUrl(u: string): string {
  return u.trim().replace(/[).,]+$/, '');
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Discover related resources for a board. Always returns validated, deduped
 * real links (or an empty list) — never invented URLs.
 */
export async function discoverResources(req: DiscoverRequest, signal: AbortSignal): Promise<SuggestedResource[]> {
  const cards = Array.isArray(req.cards) ? req.cards : [];
  if (cards.length === 0) return [];
  const user = `The board contains:\n${boardSummary(cards)}\n\nFind real related resources from the web that extend this collection.`;

  let raw: string;
  try {
    raw = await groundedSearch(user, signal);
  } catch {
    return [];
  }
  if (signal.aborted) return [];

  const seen = new Set(
    (req.existingUrls ?? []).map((u) => normUrl(u).toLowerCase()),
  );
  const out: SuggestedResource[] = [];
  for (const item of parseResources(raw)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const url = normUrl(String(o.url ?? ''));
    if (!/^https?:\/\/\S+$/i.test(url)) continue; // real links only
    const key = url.toLowerCase();
    if (seen.has(key)) continue; // no board dup, no in-result dup
    seen.add(key);
    const kind = KINDS.includes(o.kind as ResourceKind) ? (o.kind as ResourceKind) : 'other';
    const source = String(o.source ?? '').trim() || hostOf(url);
    out.push({
      title: String(o.title ?? '').slice(0, 160).trim() || source || url,
      description: String(o.description ?? '').slice(0, 280).trim(),
      url,
      kind,
      reason: String(o.reason ?? '').slice(0, 200).trim(),
      source,
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}
