/**
 * Cache remote images referenced by generated cards into the asset store.
 *
 * A generated card can carry an image URL found on the web (`![alt](https://…)`
 * from a web-search result). Hotlinking that straight from the browser is
 * fragile: hotlink protection (403), CORS, an expired URL, or a locked-down
 * network all leave a broken `<img>`. So the server fetches each image ONCE
 * (SSRF-guarded, server-to-server — which bypasses browser CORS/hotlink checks),
 * stores the bytes, and rewrites the markdown to a same-origin `/api/assets/<id>`
 * URL that always loads and survives the source going away.
 *
 * Best-effort: any image that can't be fetched/validated keeps its original URL
 * (a direct browser load may still work), so this never makes things worse.
 */

import { randomUUID } from 'node:crypto';
import { putAsset, sniffMime } from './assets.js';
import { assertPublicHttpUrl, publicOnlyAgent } from './ssrf.js';

/** `![alt](url)` — capture the alt text and the URL. */
const IMG_MD = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MiB — a thumbnail, not a hero asset

/** Fetch one remote image (SSRF-guarded, redirects re-checked per hop), store
 *  it, and return its `/api/assets/<id>` URL — or null on any failure. */
async function fetchAndStore(rawUrl: string, signal?: AbortSignal): Promise<string | null> {
  try {
    let url = await assertPublicHttpUrl(rawUrl);
    const deadline = AbortSignal.any(
      [AbortSignal.timeout(FETCH_TIMEOUT_MS), signal].filter((s): s is AbortSignal => !!s),
    );
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(url, {
        redirect: 'manual',
        signal: deadline,
        // undici honours a per-request dispatcher; publicOnlyAgent pins to the
        // resolved public IP so a redirect can't smuggle in a private target.
        dispatcher: publicOnlyAgent,
        headers: { 'user-agent': 'JarwizBot/1.0 (+image-cache)', accept: 'image/*,*/*;q=0.5' },
      } as RequestInit);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        res.body?.cancel().catch(() => {});
        if (!location) return null;
        url = await assertPublicHttpUrl(new URL(location, url).href);
        continue;
      }
      break;
    }
    if (!res || !res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    // Trust magic bytes over the header, and keep it thumbnail-sized.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    if (!sniffMime(bytes).startsWith('image/')) return null;
    const id = `img_${randomUUID()}`;
    await putAsset(id, bytes);
    return `/api/assets/${id}`;
  } catch {
    return null;
  }
}

/** On-demand cache for the `/api/image` proxy: one fetch per distinct URL,
 *  concurrent requests share the in-flight promise, and failures aren't pinned
 *  (a flaky host can succeed on a later view). Deliberately NOT tied to the
 *  requester's abort signal — a cancelled first viewer must not poison the
 *  cache for the next one; fetchAndStore carries its own timeout. */
const proxyCache = new Map<string, Promise<string | null>>();
export function cachedImageUrl(rawUrl: string): Promise<string | null> {
  let inflight = proxyCache.get(rawUrl);
  if (!inflight) {
    inflight = fetchAndStore(rawUrl);
    proxyCache.set(rawUrl, inflight);
    void inflight.then(
      (v) => { if (!v) proxyCache.delete(rawUrl); },
      () => proxyCache.delete(rawUrl),
    );
  }
  return inflight;
}

/** Collect the external image URLs in a blob of markdown (de-duped). */
function externalImageUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const m of text.matchAll(IMG_MD)) {
    const url = m[2];
    if (url && !url.startsWith('/api/assets/')) urls.add(url);
  }
  return [...urls];
}

/** Given a URL→cachedUrl map, rewrite every matching image in a string. */
function rewrite(text: string, map: Map<string, string>): string {
  if (map.size === 0) return text;
  return text.replace(IMG_MD, (whole, alt: string, url: string) => {
    const cached = map.get(url);
    return cached ? `![${alt}](${cached})` : whole;
  });
}

/** Cache every external image referenced anywhere in a table's cells and return
 *  the rows with rewritten `/api/assets` URLs. De-dupes across cells so a URL
 *  reused in several rows is fetched once. */
export async function cacheImagesInRows(rows: string[][], signal?: AbortSignal): Promise<string[][]> {
  const urls = externalImageUrls(rows.flat().join('\n'));
  if (urls.length === 0) return rows;
  const map = new Map<string, string>();
  await Promise.all(
    urls.map(async (u) => {
      const cached = await fetchAndStore(u, signal);
      if (cached) map.set(u, cached);
    }),
  );
  if (map.size === 0) return rows;
  return rows.map((r) => r.map((cell) => (cell.includes('![') ? rewrite(cell, map) : cell)));
}
