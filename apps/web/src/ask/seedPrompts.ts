/**
 * Content-aware seed prompts — Ask pills tailored to what a card actually
 * says, not just its type. Two sources share one cache + fetch path: a stored
 * PDF (by asset id) and any text card (keyed by card id + a content
 * fingerprint, so an edited card refreshes its pills). Fetched from
 * /api/seed-prompts and cached; the UI subscribes and swaps tailored pills in
 * over the static per-type fallbacks. (docs/PDF-JOURNEY.md §3)
 */

export interface SeedPrompt {
  label: string;
  prompt: string;
}

const cache = new Map<string, SeedPrompt[]>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribeSeed(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Cached prompts for an asset, or undefined if not fetched yet. */
export function getSeedPrompts(assetId: string): SeedPrompt[] | undefined {
  return cache.get(assetId);
}

function fetchSeeds(key: string, body: Record<string, string | undefined>): void {
  if (!key || cache.has(key) || inflight.has(key)) return;
  inflight.add(key);
  void fetch('/api/seed-prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then((r) => (r.ok ? r.json() : { prompts: [] }))
    .then((data: { prompts?: SeedPrompt[] }) => {
      cache.set(key, Array.isArray(data.prompts) ? data.prompts : []);
    })
    .catch(() => {
      cache.set(key, []);
    })
    .finally(() => {
      inflight.delete(key);
      emit();
    });
}

/** Kick off a fetch (idempotent) for a PDF asset's seed prompts. */
export function ensureSeedPrompts(assetId: string): void {
  if (!assetId) return;
  fetchSeeds(assetId, { assetId });
}

/** Cache key for a text card's pills — refreshes when content changes
 *  meaningfully (cheap fingerprint; close enough for suggestion pills). */
export function cardSeedKey(cardId: string, text: string, title?: string): string {
  const t = `${title ?? ''}|${text}`;
  return `${cardId}:${t.length}:${t.slice(0, 24)}:${t.slice(-24)}`;
}

/** Kick off a fetch (idempotent) for pills tailored to a text card. */
export function ensureCardSeeds(key: string, text: string, title?: string): void {
  if (!key || !text.trim()) return;
  fetchSeeds(key, { text: text.slice(0, 12_000), title: title || undefined });
}
