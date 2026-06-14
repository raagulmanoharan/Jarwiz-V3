/**
 * Content-aware suggestions — read a freshly-dropped artifact and propose the
 * agent actions that actually fit ITS content (not just its type). A compliance
 * PDF yields "Make a compliance checklist"; a recipe video yields "Extract the
 * ingredients". The server extracts the content (fetch a link / oEmbed a video
 * / parse a PDF) and asks the model what's worth doing, mapped to our agents.
 *
 * Falls back to an empty list on any failure (the client keeps the fast,
 * type-based pills). Uses the CLI sidecar for the proposal — no key needed.
 */

import { createRequire } from 'node:module';
import { isAgentId, type AgentSuggestion, type SuggestRequest } from '@jarwiz/shared';
import { fetchPageText } from './linkPreview.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';

// pdf-parse ships CJS and runs a self-test if imported from its index; load the
// inner module directly to avoid that.
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  data: Buffer,
) => Promise<{ text: string; info?: { Title?: string } }>;

const OEMBED_TIMEOUT_MS = 5_000;
const MAX_CONTENT_CHARS = 6000;

const SYSTEM_PROMPT = `You read a dropped artifact and propose the 3–4 MOST USEFUL next actions for it on a canvas. Each action is handled by exactly one of four agents:
- "summarizer": summaries, gists, key points, takeaways.
- "researcher": find related or supporting web sources.
- "brainstormer": ideas, angles, hooks, names, next steps.
- "writer": long-form drafts, comparison TABLES, deck/slide outlines, CHECKLISTS, memos, plans.

Rules:
- Tailor the actions to THIS specific content — name the actual subject; never generic ("Summarize this").
- Prefer a spread of agents when it fits the content.
- Each action: a short imperative "label" (2–5 words), the "agentId", and a one-sentence "brief" telling that agent exactly what to produce for this content.
- Return ONLY a JSON array of objects {label, agentId, brief}. No prose, no markdown, no code fences.

Example for a data-privacy policy PDF:
[{"label":"Summarize the obligations","agentId":"summarizer","brief":"Summarize the key obligations and who they apply to."},{"label":"Compliance checklist","agentId":"writer","brief":"Turn the requirements into a checklist table with a Done column."},{"label":"Open questions","agentId":"brainstormer","brief":"List ambiguities and questions a reviewer should raise."}]`;

interface YouTubeOEmbed {
  title?: string;
  author_name?: string;
}

async function fetchYouTubeOEmbed(url: string): Promise<YouTubeOEmbed | null> {
  try {
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('format', 'json');
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as YouTubeOEmbed;
  } catch {
    return null;
  }
}

async function extractPdfText(dataUrl: string): Promise<{ title: string; text: string }> {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const buf = Buffer.from(base64, 'base64');
  const parsed = await pdfParse(buf);
  return {
    title: parsed.info?.Title?.trim() || '',
    text: (parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT_CHARS),
  };
}

/** Pull the artifact's title + body text from wherever it lives. */
async function extractContent(req: SuggestRequest): Promise<{ title: string; text: string }> {
  try {
    if (req.kind === 'pdf' && req.pdfDataUrl) return await extractPdfText(req.pdfDataUrl);
    if (req.kind === 'link' && req.url) return await fetchPageText(req.url, MAX_CONTENT_CHARS);
    if (req.kind === 'youtube' && req.url) {
      const oembed = await fetchYouTubeOEmbed(req.url);
      if (oembed?.title) {
        return { title: oembed.title, text: `Video "${oembed.title}" by ${oembed.author_name ?? 'unknown'}.` };
      }
    }
  } catch {
    /* fall through to whatever the client gave us */
  }
  return { title: req.title?.trim() || '', text: '' };
}

function parseSuggestions(raw: string): AgentSuggestion[] {
  const text = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: AgentSuggestion[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const { label, agentId, brief } = item as Record<string, unknown>;
    if (typeof label !== 'string' || !label.trim()) continue;
    if (typeof agentId !== 'string' || !isAgentId(agentId)) continue;
    out.push({
      label: label.trim().slice(0, 40),
      agentId,
      brief: typeof brief === 'string' && brief.trim() ? brief.trim().slice(0, 400) : undefined,
    });
    if (out.length >= 4) break;
  }
  return out;
}

export async function proposeSuggestions(
  req: SuggestRequest,
  signal: AbortSignal,
): Promise<AgentSuggestion[]> {
  if (!sidecarAvailable() && !process.env.ANTHROPIC_API_KEY?.trim()) return [];
  const { title, text } = await extractContent(req);
  if (!title && !text) return []; // nothing to reason about → keep type-based
  const user = `Artifact kind: ${req.kind}\nTitle: ${title || '(none)'}\n\nContent:\n"""\n${text}\n"""`;
  try {
    const raw = await sidecarGenerate({ system: SYSTEM_PROMPT, user, signal, timeoutMs: 45_000 });
    return parseSuggestions(raw);
  } catch {
    return [];
  }
}
