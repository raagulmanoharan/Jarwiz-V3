/**
 * Content-aware seed prompts for a dropped PDF — predefined Ask prompts that
 * defeat the blank-slate problem (docs/PDF-JOURNEY.md §3). Fetched once per
 * asset from /api/seed-prompts and cached; the UI subscribes for updates.
 * Clicking a seed pill runs the same Ask pipeline as a typed question.
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

/** Kick off a fetch (idempotent) for an asset's seed prompts. */
export function ensureSeedPrompts(assetId: string): void {
  if (!assetId || cache.has(assetId) || inflight.has(assetId)) return;
  inflight.add(assetId);
  void fetch('/api/seed-prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId }),
  })
    .then((r) => (r.ok ? r.json() : { prompts: [] }))
    .then((data: { prompts?: SeedPrompt[] }) => {
      cache.set(assetId, Array.isArray(data.prompts) ? data.prompts : []);
    })
    .catch(() => {
      cache.set(assetId, []);
    })
    .finally(() => {
      inflight.delete(assetId);
      emit();
    });
}
