/**
 * Scout — grounded resource discovery. Read the board, then use Claude's
 * live web search to surface REAL related resources (videos, papers, docs,
 * articles, repos). Grounding is the whole point: an ungrounded model invents
 * dead arxiv IDs and 404 YouTube links, and one dead link kills the promise.
 * So the model searches, and this module then VALIDATES (http(s) only) and
 * DEDUPES (against the board and within the results) before returning anything.
 *
 * This is the Claude/monorepo re-implementation of the feature PR #4 built on
 * the old flat Gemini scaffold — same idea, our engine (webTools.ts).
 */

import type { AnalyzeCard, DiscoverRequest, ResourceKind, SuggestedResource } from '@jarwiz/shared';
import { RESEARCH_MAX_CONTINUATIONS, researchToolset } from './webTools.js';
import { generateText } from './generate.js';
import { parseJsonArray } from './util.js';

const MAX_CARDS = 24;
const MAX_TEXT_PER_CARD = 700;
const MAX_RESULTS = 9;
const MAX_TOKENS = 3200;
const SIDECAR_TIMEOUT_MS = 300_000;

const KINDS: ResourceKind[] = ['video', 'news', 'article', 'paper', 'pdf', 'doc', 'repo', 'other'];

const SYSTEM = `You are Scout — a DEEP RESEARCH discovery engine on an infinite canvas. The user has collected things on their board; your job is to find the resources a sharp domain expert would hand them next. This is a researched artefact, NOT a top-5 Google dump.

Work in two stages:
1) THEME the board. First read everything and infer the 2–4 TOPICS the collection is really about — the throughlines, the open questions, the gaps the user is circling. Discovery is driven by these themes, not by matching individual cards one-to-one.
2) RESEARCH each theme HARD. Run multiple searches per theme, follow leads, and CURATE: prefer canonical primary sources over blog-about-it noise — the actual paper (not a summary), the official docs, the real repo, the definitive talk, the essay everyone cites. Cross-check that a link is real and on-point. Deliberately span kinds AND sources — a suggestion can be anything useful: a YouTube video, a news story, a PDF, an academic paper, a GitHub repo, official docs, a blog/essay, or any other link. Aim for a mix across a theme; never five links from one site or all of one kind. It is better to return 6 genuinely excellent, non-obvious resources than 9 first-page results.

Every resource must earn its place: it either fills a GAP the board is missing, advances an open question on the board, or is the authoritative source behind something already there.

Return ONLY a JSON array (no prose, no code fences) of up to ${MAX_RESULTS} objects, ordered best-first, grouped by theme:
{"topic": string (the board theme, 2–4 words, REUSE the same wording across resources in the same theme), "title": string, "description": string (one tight sentence on what it is), "url": string (the real, complete http(s) URL you found), "kind": "video"|"news"|"article"|"paper"|"pdf"|"doc"|"repo"|"other" (pick the truest type — "video" for YouTube/talks, "news" for press/journalism, "pdf" for direct PDF links, "paper" for academic work, "repo" for code, "doc" for official docs, "article" for blogs/essays), "reason": string (a SMART, specific connection in ONE SHORT LINE — name the gap it fills or the board item it advances; keep it under ~14 words so it reads on a single line; e.g. "The reference sync implementation your CRDT note is missing." Do NOT just say "because you saved X."), "source": string (site name, e.g. "arxiv.org")}

Rules: only URLs you actually found via search; never invent one; no duplicates; nothing behind a login wall. Quality over quantity — a shorter, sharper list wins.`;

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

/** Deep grounded research with the web tools; returns the model's raw text. */
function groundedSearch(user: string, signal: AbortSignal): Promise<string> {
  return generateText({
    system: SYSTEM,
    user,
    signal,
    maxTokens: MAX_TOKENS,
    sidecarTimeoutMs: SIDECAR_TIMEOUT_MS,
    web: { tools: researchToolset(), maxTurns: RESEARCH_MAX_CONTINUATIONS },
  });
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
  const user = `The board contains:\n${boardSummary(cards)}\n\nInfer the themes of this collection, then research each deeply and return the curated resources.`;

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
  for (const item of parseJsonArray(raw)) {
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
      reason: String(o.reason ?? '').slice(0, 240).trim(),
      source,
      topic: String(o.topic ?? '').slice(0, 48).trim(),
    });
    if (out.length >= MAX_RESULTS) break;
  }
  // Keep themes contiguous so the drawer can group them cleanly.
  const order = new Map<string, number>();
  out.forEach((r) => { if (!order.has(r.topic)) order.set(r.topic, order.size); });
  out.sort((a, b) => (order.get(a.topic)! - order.get(b.topic)!));
  return out;
}
