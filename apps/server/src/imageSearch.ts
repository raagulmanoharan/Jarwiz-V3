/**
 * Real images for generated cards — a `find_image` tool the model can call
 * while composing a rich answer. Providers, best first:
 *
 *   1. Google Programmable Search (image mode) — Google-Images-grade results
 *      for ANY subject, including commercial products. Opt-in: set
 *      GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID on the server (same
 *      place as ANTHROPIC_API_KEY; free tier is 100 queries/day).
 *   2. The keyless OPEN set, queried in parallel and merged in this order:
 *      - Wikipedia lead image — the photo atop the subject's article, usually
 *        THE canonical picture of any notable thing.
 *      - Wikimedia Commons search — openly licensed; strong on encyclopedic
 *        subjects (places, hardware, people, nature).
 *      - Openverse — the Creative Commons search engine (~800M images from
 *        Flickr, museums, archives); broadens coverage past encyclopedic.
 *      - iTunes/Apple Search — the catalog artwork the CC libraries can't have:
 *        movie POSTERS, TV art, album covers, book covers, app icons. Keyless.
 *        Tried FIRST for a catalog-artwork query (a film/album title makes the
 *        CC providers return tangential junk that would crowd the real art out),
 *        and otherwise last in the merge as a fallback.
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
const ITUNES_API = 'https://itunes.apple.com/search';
const FETCH_TIMEOUT_MS = 8000;
/** Rendered width requested from thumbnail-capable APIs — matches the card's
 *  hero size so we don't pull multi-megabyte originals through the proxy. */
const THUMB_WIDTH = 960;
/** iTunes hands back a 100px `artworkUrl100`; mzstatic renders any bounding box,
 *  so we swap in a card-sized one instead of pulling a thumbnail-sharp poster. */
const ITUNES_ART_SIZE = 600;

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
    'else Wikipedia lead images, Wikimedia Commons, Openverse, and iTunes/Apple catalog artwork — ' +
    'movie posters, album and book covers, app icons — in parallel). Returns image URLs ' +
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

/** Upscale an iTunes `artworkUrl100` to a card-sized render. The URL ends in
 *  `.../100x100bb.jpg` (or `.png`); mzstatic serves any bounding box, so we swap
 *  the dimensions. Non-matching URLs pass through unchanged (still a valid img). */
export function upscaleItunesArtwork(url: string): string {
  return url.replace(/\/\d+x\d+bb\.(jpg|jpeg|png)(\?.*)?$/i, `/${ITUNES_ART_SIZE}x${ITUNES_ART_SIZE}bb.$1`);
}

/** Parse an iTunes Search response into candidates — the catalog artwork
 *  (movie posters, album/book covers, app icons). Pure — tested against a
 *  fixture; the sandbox has no network. */
export function parseItunesResponse(json: unknown): FoundImage[] {
  const results = (json as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  const out: FoundImage[] = [];
  for (const r of results) {
    const it = r as {
      artworkUrl100?: string;
      artworkUrl60?: string;
      trackName?: string;
      collectionName?: string;
      trackViewUrl?: string;
      collectionViewUrl?: string;
    };
    const art = it.artworkUrl100 || it.artworkUrl60 || '';
    if (!art) continue;
    out.push({
      url: upscaleItunesArtwork(art),
      title: it.trackName || it.collectionName || '',
      // Apple catalog artwork carries no CC license — attribute the store page.
      page: it.trackViewUrl || it.collectionViewUrl || '',
      license: '',
    });
  }
  return out;
}

/** iTunes/Apple Search — keyless catalog artwork the CC libraries structurally
 *  lack (movie posters, album/book covers, app icons). `media` is left open so
 *  one lookup covers movies, TV, music, books, and apps alike. */
async function searchItunes(query: string, count: number): Promise<FoundImage[]> {
  const params = new URLSearchParams({
    term: query,
    limit: String(Math.max(1, Math.min(5, count))),
    country: 'US',
  });
  try {
    const res = await fetch(`${ITUNES_API}?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'JarwizBot/1.0 (+find-image)' },
    });
    if (!res.ok) return [];
    return parseItunesResponse(await res.json());
  } catch {
    return [];
  }
}

/** Catalog-artwork intent in a query — a poster / cover / app icon the CC
 *  libraries structurally lack. When present, iTunes is the RIGHT source and is
 *  tried FIRST: for a film or album title the encyclopedic providers return
 *  tangential junk that isn't the art (a movie's prop gun, a same-named concept
 *  car, the person the film is about), and being non-empty they'd otherwise
 *  crowd the real poster out of the results. The model is prompted to phrase
 *  these queries with the medium word ("Oppenheimer movie poster"). */
const CATALOG_ARTWORK_RE =
  /\b(poster|movie|film|soundtrack|album|audiobook|book cover|cover art|box art|app icon|game cover|video game)\b/i;

/** The descriptor words the model appends to signal artwork intent — stripped
 *  before we hit iTunes, because they POLLUTE the match ("The Dark Knight movie
 *  poster" finds a podcast about posters; the bare "The Dark Knight" finds the
 *  film). Kept narrow so it never eats a real title word (no "book"/"game"). */
const CATALOG_STRIP_RE =
  /\b(movie|movies|film|films|cinematic|poster|posters|cover art|box art|key art|artwork|cover|covers|album|soundtrack|ost|audiobook|app icon)\b/gi;

/** Which mzstatic artwork kind the query wants, so we can prefer it when iTunes
 *  ranks a same-named item of the wrong medium first (an "Abbey Road" search
 *  surfaces the film *Yesterday*; a film search surfaces its soundtrack album).
 *  The path segment appears in every mzstatic URL (…/image/thumb/Video…/Music…). */
function preferredArtSegment(query: string): string | null {
  if (/\b(album|song|songs|single|ep|soundtrack|ost|music)\b/i.test(query)) return '/Music';
  if (/\b(poster|movie|film|cinema|trailer|tv|television|show|series|season|episode)\b/i.test(query)) return '/Video';
  return null;
}

/** Guard against iTunes returning a wholly unrelated item when it lacks the real
 *  one (searching "Parasite" with no catalog match surfaces "Superman"). Keep a
 *  result only if its title shares a meaningful word (4+ chars) with the search
 *  term; when the term has no such word, don't over-filter. */
function titleRelevant(term: string, title: string): boolean {
  const tokens = term.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  if (tokens.length === 0) return true;
  const t = title.toLowerCase();
  return tokens.some((tok) => t.includes(tok));
}

/** The provider chain: Google (when keys are configured) wins outright; else,
 *  for a catalog-artwork query, iTunes is tried FIRST (see above); otherwise the
 *  keyless open set runs in PARALLEL (latency doesn't stack) and merges
 *  Wikipedia-lead → Commons → Openverse → iTunes, de-duped by URL. iTunes stays
 *  last in that merge so encyclopedic subjects still prefer the CC photo — it
 *  only surfaces when the open trio came up empty. */
export async function searchImages(query: string, count = 3): Promise<FoundImage[]> {
  const google = await searchGoogleImages(query, count);
  if (google.length > 0) return google.slice(0, count);
  // Posters/covers/app icons: the CC trio returns tangential encyclopedic hits
  // for a film/album title, so go to the catalog source first — with the medium
  // descriptor stripped (it pollutes the match) and, for a film query, video
  // artwork (the poster) preferred over a same-named soundtrack album.
  if (CATALOG_ARTWORK_RE.test(query)) {
    const term = query.replace(CATALOG_STRIP_RE, ' ').replace(/\s+/g, ' ').trim() || query;
    let artwork = (await searchItunes(term, Math.max(count, 5))).filter((img) =>
      titleRelevant(term, img.title),
    );
    const seg = preferredArtSegment(query);
    if (seg) {
      artwork = [...artwork].sort(
        (a, b) => Number(b.url.includes(seg)) - Number(a.url.includes(seg)),
      );
    }
    if (artwork.length > 0) return artwork.slice(0, count);
  }
  const [wiki, commons, openverse, itunes] = await Promise.all([
    searchWikipediaLead(query),
    searchCommonsImages(query, count),
    searchOpenverse(query, count),
    searchItunes(query, count),
  ]);
  const merged: FoundImage[] = [];
  const seen = new Set<string>();
  for (const img of [...wiki, ...commons, ...openverse, ...itunes]) {
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
