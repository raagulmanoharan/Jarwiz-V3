/**
 * Real images for generated cards — a `find_image` tool the model can call
 * while composing a rich answer. Searches Wikimedia Commons (free, openly
 * licensed, covers most research subjects: places, products, people, space
 * hardware…) and returns actual image URLs with attribution, so a research
 * card can carry a genuine photo instead of hoping a fetched page happened to
 * expose one. The model never invents an image URL — this tool is where real
 * ones come from; the /api/image cache-proxy then makes them durable at
 * render time.
 */

import type Anthropic from '@anthropic-ai/sdk';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const FETCH_TIMEOUT_MS = 8000;
/** Rendered width requested from Commons — matches the card's hero size so we
 *  don't pull multi-megabyte originals through the cache-proxy. */
const THUMB_WIDTH = 960;

export interface FoundImage {
  url: string;
  title: string;
  /** The Commons file page — human attribution target. */
  page: string;
  license: string;
}

/** The tool as offered to the model alongside web_search/web_fetch. */
export const FIND_IMAGE_TOOL: Anthropic.Tool = {
  name: 'find_image',
  description:
    'Find a REAL, freely-licensed photo or illustration of a subject (searches Wikimedia Commons). ' +
    'Returns image URLs with title, license, and attribution page. Use the returned url verbatim in ' +
    'Image(src, caption) or ![alt](url) — never alter or invent image URLs. Query with a short, ' +
    'concrete subject ("Hubble Space Telescope", "Aeron chair"), not a sentence.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Short concrete subject to find an image of.' },
      count: { type: 'number', description: 'How many candidates to return (1–5, default 3).' },
    },
    required: ['query'],
  },
};

/** Parse a Commons generator=search + imageinfo response into candidates.
 *  Pure — exercised directly by tests since the sandbox has no network. */
export function parseCommonsResponse(json: unknown): FoundImage[] {
  const pages = (json as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!pages || typeof pages !== 'object') return [];
  const out: Array<FoundImage & { index: number }> = [];
  for (const page of Object.values(pages)) {
    const p = page as {
      title?: string;
      index?: number;
      imageinfo?: Array<{
        thumburl?: string;
        url?: string;
        mime?: string;
        descriptionurl?: string;
        extmetadata?: { LicenseShortName?: { value?: string } };
      }>;
    };
    const info = p.imageinfo?.[0];
    if (!info) continue;
    const url = info.thumburl || info.url || '';
    // Photos/illustrations only — an SVG icon or a PDF scan isn't a hero image.
    if (!url || !/^image\/(jpeg|png|webp|gif)$/i.test(info.mime ?? '')) continue;
    out.push({
      url,
      title: (p.title ?? '').replace(/^File:/, ''),
      page: info.descriptionurl ?? '',
      license: info.extmetadata?.LicenseShortName?.value ?? '',
      index: p.index ?? 0, // Commons keys pages by pageid; `index` is relevance
    });
  }
  return out.sort((a, b) => a.index - b.index).map(({ index: _i, ...img }) => img);
}

/** Search Commons for images of `query`. Best-effort: any failure returns []
 *  — the model is told to simply skip images when none come back. */
export async function searchCommonsImages(query: string, count = 3): Promise<FoundImage[]> {
  const n = Math.max(1, Math.min(5, Math.round(count)));
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6', // File:
    gsrsearch: query,
    gsrlimit: String(n * 2), // headroom — some hits are non-photo mimes
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: String(THUMB_WIDTH),
  });
  try {
    const res = await fetch(`${COMMONS_API}?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'JarwizBot/1.0 (+find-image)' },
    });
    if (!res.ok) return [];
    return parseCommonsResponse(await res.json()).slice(0, n);
  } catch {
    return [];
  }
}

/** Execute a find_image tool call; the returned string goes back to the model
 *  as the tool_result. Always valid JSON, never a thrown error — a failed
 *  lookup must read as "no images", not break the generation turn. */
export async function runFindImage(input: unknown): Promise<string> {
  const { query, count } = (input ?? {}) as { query?: unknown; count?: unknown };
  const q = String(query ?? '').trim();
  if (!q) return JSON.stringify({ images: [], note: 'empty query' });
  const images = await searchCommonsImages(q, typeof count === 'number' ? count : 3);
  if (images.length === 0) {
    return JSON.stringify({ images: [], note: 'no freely-licensed image found — skip the image' });
  }
  return JSON.stringify({ images });
}
