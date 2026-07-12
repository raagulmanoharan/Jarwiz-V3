/**
 * Backend availability — whether an agent runtime is reachable behind /api,
 * and what it can do for THIS visitor.
 *
 * One probe of GET /api/capabilities at startup (through the fetch bridge, so
 * the visitor's BYOK key rides along) settles three states the AI surfaces
 * read to set expectations up front instead of failing with raw 404s:
 *
 *   down          — static hosting, no server at all (the "playground").
 *   up + 'demo'   — server alive but keyless: scripted mock answers; the
 *                   PromptBar invites the visitor to add their own key.
 *   up + 'api'/'sidecar' — the real thing.
 *
 * Optimistic until proven otherwise: `unknown` counts as available, so local
 * dev never flashes a notice while probing. Saving a key calls reprobe() and
 * the whole app lights up without a reload.
 */

export type BackendMode = 'api' | 'sidecar' | 'demo';

export interface PilotBudget {
  used: number;
  limit: number;
}

export interface BackendState {
  availability: 'unknown' | 'up' | 'down';
  mode: BackendMode | null;
  /** Closed-pilot budget for this visitor's invite code, when one is set. */
  pilot: PilotBudget | null;
}

let state: BackendState = { availability: 'unknown', mode: null, pilot: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeBackend(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBackendSnapshot(): BackendState {
  return state;
}

/** True only once the probe has positively established there is no backend. */
export function backendDown(): boolean {
  return state.availability === 'down';
}

/** What the hosted playground says wherever an agent would have answered. */
export const PLAYGROUND_NOTICE =
  'Playground mode — AI agents are off on this hosted demo. Everything you make still saves in this browser.';

export const PLAYGROUND_ERROR =
  'AI agents aren’t available on this hosted playground. The canvas itself keeps working, saved in this browser.';

/** Server up but keyless — the mock answers; a real key wakes the agents. */
export const DEMO_NOTICE = 'Demo mode — agents answer with a script.';

export const KEY_REJECTED_ERROR =
  'That Anthropic API key was rejected — re-check it in the key settings (top right).';

/** Swap a raw network/auth failure for a message a person can act on. */
export function agentErrorMessage(raw: string): string {
  if (backendDown()) return PLAYGROUND_ERROR;
  if (raw.includes('authentication_error') || /^401\b/.test(raw)) return KEY_REJECTED_ERROR;
  return raw;
}

let probing = false;

/** Fire the health probe. Call once at app boot; safe to re-call. */
export function probeBackend(): void {
  if (probing || state.availability !== 'unknown') return;
  probing = true;
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), 5000);
  void fetch('/api/capabilities', { signal: ac.signal })
    .then(async (res) => {
      // Static hosts answer /api/* with their 404 page (or an index.html
      // rewrite) — only real JSON with a mode counts as a backend.
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as
        | { mode?: string; pilot?: { used?: number; limit?: number } }
        | null;
      if (body?.mode !== 'api' && body?.mode !== 'sidecar' && body?.mode !== 'demo') return null;
      const pilot =
        typeof body.pilot?.used === 'number' && typeof body.pilot?.limit === 'number'
          ? { used: body.pilot.used, limit: body.pilot.limit }
          : null;
      return { mode: body.mode as BackendMode, pilot };
    })
    .catch(() => null)
    .then((result) => {
      window.clearTimeout(timer);
      probing = false;
      state = result
        ? { availability: 'up', mode: result.mode, pilot: result.pilot }
        : { availability: 'down', mode: null, pilot: null };
      emit();
    });
}

/** The visitor just added/removed their key — ask the server again. */
export function reprobeBackend(): void {
  if (probing) return;
  state = { availability: 'unknown', mode: null, pilot: null };
  emit();
  probeBackend();
}
