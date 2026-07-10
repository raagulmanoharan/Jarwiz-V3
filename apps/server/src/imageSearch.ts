/**
 * Real images for generated cards — a `find_image` tool the model can call
 * while composing a rich answer. Providers, best first:
 *
 *   1. Google Programmable Search (image mode) — Google-Images-grade results
 *      for ANY subject, including commercial products. Opt-in: set
 *      GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID on the server (same
 *      place as ANTHROPIC_API_KEY; free tier is 100 queries/day).
 *   2. The keyless OPEN trio, queried in parallel and merged in this order:
 *      - Wikipedia lead image — the photo atop the subject's article, usually
 *        THE canonical picture of any notable thing.
 *      - Wikimedia Commons search — openly licensed; strong on encyclopedic
 *        subjects (places, hardware, people, nature).
 *      - Openverse — the Creative Commons search engine (~800M images from
 *        Flickr, museums, archives); broadens coverage past encyclopedic.
 *   3. Nothing — the model is told to skip the image, never invent a URL.
 *
 * The /api/image cache-proxy then makes whichever URL wins durable at render
 * time (fetched once server-side, served same-origin).
 */

import type Anthropic from '@anthropic-ai/sdk';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
const GOOGLE_API = 'https://www.googleapis.com/customsearch/v1';
const FETCH_TIMEOUT_MS = 8000;
/** Rendered width requested from thumbnail-capable APIs — matches the card's
 *  hero size so we don't pull multi-megabyte originals through the proxy. */
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
    'Find a REAL photo or illustration of a subject via image search (Google Images when configured; ' +
    'else Wikipedia lead images, Wikimedia Commons, and Openverse in parallel). Returns image URLs ' +
    'with title and an attribution page (license included when known). Use the returned url verbatim ' +
    'in Image(src, caption) or ![alt](url) — never alter or invent image URLs; caption with the ' +
    'source (page or license). Query with a short, concrete subject ("Hubble Space Telescope", ' +
    '"Aeron chair"), not a sentence.',
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

/** Parse a Google Programmable Search image response into candidates.
 *  Pure — exercised directly by tests since the sandbox has no network. */
export function parseGoogleResponse(json: unknown): FoundImage[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const out: FoundImage[] = [];
  for (const item of items) {
    const it = item as {
      link?: string;
      title?: string;
      mime?: string;
      image?: { contextLink?: string };
    };
    if (!it.link || !/^image\//i.test(it.mime ?? '')) continue;
    out.push({
      url: it.link,
      title: it.title ?? '',
      page: it.image?.contextLink ?? '',
      // Google image results carry no license metadata — the caption should
      // attribute the source page, not claim a license.
      license: '',
    });
  }
  return out;
}

/** Google-Images-grade search — only when the operator has configured keys. */
async function searchGoogleImages(query: string, count: number): Promise<FoundImage[]> {
  const key = process.env.GOOGLE_SEARCH_API_KEY?.trim();
  const cx = process.env.GOOGLE_SEARCH_ENGINE_ID?.trim();
  if (!key || !cx) return [];
  const params = new URLSearchParams({
    key,
    cx,
    q: query,
    searchType: 'image',
    num: String(Math.max(1, Math.min(5, count))),
    safe: 'active',
    imgSize: 'large',
  });
  try {
    const res = await fetch(`${GOOGLE_API}?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'JarwizBot/1.0 (+find-image)' },
    });
    if (!res.ok) return [];
    return parseGoogleResponse(await res.json());
  } catch {
    return [];
  }
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

/** Parse a Wikipedia generator=search + pageimages response: the lead image
 *  of the best-matching article. Pure — tested against a fixture. */
export function parseWikipediaResponse(json: unknown): FoundImage[] {
  const pages = (json as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!pages || typeof pages !== 'object') return [];
  const out: Array<FoundImage & { index: number }> = [];
  for (const page of Object.values(pages)) {
    const p = page as {
      title?: string;
      index?: number;
      fullurl?: string;
      thumbnail?: { source?: string };
    };
    if (!p.thumbnail?.source) continue;
    out.push({
      url: p.thumbnail.source,
      title: p.title ?? '',
      page: p.fullurl ?? '',
      // Lead images are typically free but not uniformly — attribute the
      // article page rather than asserting a license we didn't read.
      license: '',
      index: p.index ?? 0,
    });
  }
  return out.sort((a, b) => a.index - b.index).map(({ index: _i, ...img }) => img);
}

/** The lead image of the subject's Wikipedia article — one lookup, usually
 *  THE canonical photo of any notable subject. */
async function searchWikipediaLead(query: string): Promise<FoundImage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '2',
    prop: 'pageimages|info',
    piprop: 'thumbnail',
    pithumbsize: String(THUMB_WIDTH),
    inprop: 'url',
  });
  try {
    const res = await fetch(`${WIKIPEDIA_API}?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'JarwizBot/1.0 (+find-image)' },
    });
    if (!res.ok) return [];
    return parseWikipediaResponse(await res.json());
  } catch {
    return [];
  }
}

/** Parse an Openverse /v1/images response. Pure — tested against a fixture. */
export function parseOpenverseResponse(json: unknown): FoundImage[] {
  const results = (json as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  const out: FoundImage[] = [];
  for (const r of results) {
    const it = r as {
      url?: string;
      thumbnail?: string;
      title?: string;
      license?: string;
      license_version?: string;
      foreign_landing_url?: string;
    };
    const url = it.thumbnail || it.url || '';
    if (!url) continue;
    out.push({
      url,
      title: it.title ?? '',
      page: it.foreign_landing_url ?? '',
      license: it.license ? `${it.license.toUpperCase()}${it.license_version ? ` ${it.license_version}` : ''}` : '',
    });
  }
  return out;
}

/** Openverse — the Creative Commons search engine. Keyless (anonymous tier). */
async function searchOpenverse(query: string, count: number): Promise<FoundImage[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: String(Math.max(1, Math.min(5, count))),
    mature: 'false',
  });
  try {
    const res = await fetch(`${OPENVERSE_API}?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'JarwizBot/1.0 (+find-image)' },
    });
    if (!res.ok) return [];
    return parseOpenverseResponse(await res.json());
  } catch {
    return [];
  }
}

/** The provider chain: Google (when keys are configured) wins outright; else
 *  the keyless open trio runs in PARALLEL (latency doesn't stack) and merges
 *  Wikipedia-lead → Commons → Openverse, de-duped by URL. */
export async function searchImages(query: string, count = 3): Promise<FoundImage[]> {
  const google = await searchGoogleImages(query, count);
  if (google.length > 0) return google.slice(0, count);
  const [wiki, commons, openverse] = await Promise.all([
    searchWikipediaLead(query),
    searchCommonsImages(query, count),
    searchOpenverse(query, count),
  ]);
  const merged: FoundImage[] = [];
  const seen = new Set<string>();
  for (const img of [...wiki, ...commons, ...openverse]) {
    if (seen.has(img.url)) continue;
    seen.add(img.url);
    merged.push(img);
  }
  return merged.slice(0, count);
}

/** Execute a find_image tool call; the returned string goes back to the model
 *  as the tool_result. Always valid JSON, never a thrown error — a failed
 *  lookup must read as "no images", not break the generation turn. */
export async function runFindImage(input: unknown): Promise<string> {
  const { query, count } = (input ?? {}) as { query?: unknown; count?: unknown };
  const q = String(query ?? '').trim();
  if (!q) return JSON.stringify({ images: [], note: 'empty query' });
  const images = await searchImages(q, typeof count === 'number' ? count : 3);
  if (images.length === 0) {
    return JSON.stringify({ images: [], note: 'no image found — skip the image' });
  }
  return JSON.stringify({ images });
}
