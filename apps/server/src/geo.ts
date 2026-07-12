/**
 * Geocoding — place-name → coordinates via OSM Nominatim, wrapped to honour
 * their usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 * results are CACHED (mandatory), requests are globally throttled to ≤1/s, and
 * every call carries an identifying User-Agent. The host is a fixed constant —
 * only the query string is model-provided — so this needs the throttle+cache
 * treatment, not the SSRF dance reserved for untrusted URLs.
 *
 * Used by the map card's Ask pipeline (docs/MAPS.md): the model proposes
 * region-qualified queries; this resolves them before each `map.pin` is
 * emitted. Failures return null — the caller decides the honest fallback
 * (model coordinates flagged `approx`), never a silent wrong pin.
 */

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
/** Nominatim requires an identifying UA; stock library strings get blocked. */
const USER_AGENT = 'Jarwiz/0.1 (AI canvas; github.com/raagulmanoharan/Jarwiz-V3)';
/** ≥1s between requests — the policy's hard ceiling, with a little margin. */
const THROTTLE_MS = 1100;
const FETCH_TIMEOUT_MS = 9000;

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Nominatim's resolved display name — handy for sanity-checking a match. */
  displayName?: string;
}

/** One fetch per distinct query, shared by concurrent callers; misses aren't
 *  pinned so a transient failure can succeed on a later run. */
const cache = new Map<string, Promise<GeoPoint | null>>();

/** Global request chain — serialises every live lookup THROTTLE_MS apart, no
 *  matter how many map runs are in flight. Cache hits never enter the chain. */
let chain: Promise<unknown> = Promise.resolve();
function throttled<TValue>(job: () => Promise<TValue>): Promise<TValue> {
  const next = chain.then(job);
  // The chain swallows results/errors (each caller gets them via `next`) and
  // spaces the FOLLOWING request one throttle window after this one settles.
  chain = next.then(
    () => new Promise((r) => setTimeout(r, THROTTLE_MS)),
    () => new Promise((r) => setTimeout(r, THROTTLE_MS)),
  );
  return next;
}

async function lookup(query: string, signal?: AbortSignal): Promise<GeoPoint | null> {
  const url = `${NOMINATIM_SEARCH}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const deadline = AbortSignal.any(
    [AbortSignal.timeout(FETCH_TIMEOUT_MS), signal].filter((s): s is AbortSignal => Boolean(s)),
  );
  const res = await fetch(url, {
    signal: deadline,
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
  const hit = Array.isArray(body) ? body[0] : undefined;
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, displayName: hit?.display_name };
}

/** Resolve a place query to coordinates, or null when it can't be verified.
 *  Cached forever for the process lifetime (place coordinates don't move). */
export function geocode(query: string, signal?: AbortSignal): Promise<GeoPoint | null> {
  const key = query.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  let inflight = cache.get(key);
  if (!inflight) {
    inflight = throttled(() => lookup(query, signal)).catch(() => null);
    cache.set(key, inflight);
    void inflight.then((v) => {
      if (!v) cache.delete(key);
    });
  }
  return inflight;
}

/* ── region sanity check ─────────────────────────────────────────────────── */

/** Great-circle distance in km (haversine — plenty for a sanity check). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

/** The medoid — the point with the smallest total distance to the others.
 *  A trip's stops cluster; a mis-geocoded "Savandurga" in another state is the
 *  outlier this anchors against (docs/MAPS.md "serving the pins honestly"). */
export function medoid<TPoint extends { lat: number; lng: number }>(points: TPoint[]): TPoint | null {
  if (points.length === 0) return null;
  let best = points[0]!;
  let bestSum = Infinity;
  for (const p of points) {
    const sum = points.reduce((acc, q) => acc + distanceKm(p, q), 0);
    if (sum < bestSum) {
      bestSum = sum;
      best = p;
    }
  }
  return best;
}

/* ── stop verification (shared by the map card and the inline doc block) ── */

/** A trip's stops cluster geographically; a geocode hit farther than this from
 *  the group's medoid is treated as a mis-match and demoted to "approximate". */
const REGION_KM = 500;

/** What the model proposes per stop (coordinates are its fallback guess). */
export interface ProposedStop {
  name: string;
  query: string;
  day?: string;
  time?: string;
  note?: string;
  lat?: number;
  lng?: number;
}

/** A stop with a location we either verified or visibly doubt. */
export interface LocatedStop extends Omit<ProposedStop, 'lat' | 'lng'> {
  lat: number;
  lng: number;
  approx?: boolean;
}

const plausible = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
  !(Math.abs(lat) < 0.5 && Math.abs(lng) < 0.5); // null island = no guess

/**
 * Verify every proposed stop: geocode its query (cached, throttled); a miss
 * falls back to the model's own coordinates flagged `approx` (the UI renders
 * the doubt), or drops the stop when there's no fallback at all — never a
 * silently wrong pin. A ≥3-stop set then demotes outliers far from the
 * group's medoid the same way.
 */
export async function locateStops(proposed: ProposedStop[], signal?: AbortSignal): Promise<LocatedStop[]> {
  const located: LocatedStop[] = [];
  for (const stop of proposed) {
    if (signal?.aborted) break;
    const hit = await geocode(stop.query, signal);
    const { lat: guessLat, lng: guessLng, ...rest } = stop;
    if (hit) located.push({ ...rest, lat: hit.lat, lng: hit.lng });
    else if (plausible(guessLat, guessLng)) located.push({ ...rest, lat: guessLat!, lng: guessLng!, approx: true });
    // Unverifiable with no fallback guess → dropped, not invented.
  }
  if (located.length >= 3) {
    const anchor = medoid(located.filter((l) => !l.approx));
    if (anchor) {
      for (const l of located) {
        if (!l.approx && distanceKm(l, anchor) > REGION_KM) l.approx = true;
      }
    }
  }
  return located;
}
