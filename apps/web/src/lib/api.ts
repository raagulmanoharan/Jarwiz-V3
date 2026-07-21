/**
 * How a static build reaches a remote agent server — API base + BYOK key.
 *
 * The hosted app is a static site (GitHub Pages); the agent server lives on
 * another origin, named at build time by VITE_API_BASE (empty = same origin,
 * i.e. local dev's vite proxy). Visitors bring their own Anthropic key — it
 * lives ONLY in this browser (localStorage) and is attached per-request as an
 * `x-anthropic-key` header, which the server scopes to that one request.
 *
 * Every server call in the app is a literal fetch('/api/…'), so rather than
 * threading a base URL through ~20 call sites, installApiBridge() wraps
 * window.fetch once: requests to /api/* get the base prefixed and the key
 * attached; everything else passes through untouched. The key can never ride
 * on a non-/api request, so it can't leak to third-party hosts.
 */

const KEY_STORAGE = 'jz-anthropic-key';

export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '')
  .trim()
  .replace(/\/+$/, '');

/** Absolute form of a root-relative /api URL — also for <img src>, which
 *  doesn't go through fetch. No-op when there's no remote base (local dev). */
export function apiUrl(path: string): string {
  return API_BASE && path.startsWith('/api/') ? `${API_BASE}${path}` : path;
}

// ── The visitor's own key (BYOK) — a tiny external store ────────────────────

const cachedKey: string | null = readStoredKey();

function readStoredKey(): string | null {
  try {
    return window.localStorage.getItem(KEY_STORAGE);
  } catch {
    return null; // storage blocked (private mode) — key just won't persist
  }
}

// ── Pilot invite code — same shape, separate credential ─────────────────────
//
// A closed-pilot invite arrives as a link (app/?pilot=CODE); the code is
// remembered here and rides every /api call as `x-jarwiz-pilot`, unlocking
// the server's own key with a metered budget (apps/server/src/pilot.ts).

const PILOT_STORAGE = 'jz-pilot-code';

let cachedPilot: string | null = readStored(PILOT_STORAGE);

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setPilotCode(code: string | null): void {
  cachedPilot = code?.trim() || null;
  try {
    if (cachedPilot) window.localStorage.setItem(PILOT_STORAGE, cachedPilot);
    else window.localStorage.removeItem(PILOT_STORAGE);
  } catch {
    /* storage blocked — works for this tab's lifetime */
  }
}

/** Adopt an invite from the URL (?pilot=CODE), then tidy the address bar so
 *  the code doesn't linger in history/screenshots. Call before the probe. */
export function capturePilotCode(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('pilot')?.trim();
    if (!code) return;
    setPilotCode(code);
    params.delete('pilot');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  } catch {
    /* URL APIs blocked — the link still works, just unsaved */
  }
}

// ── The fetch bridge ─────────────────────────────────────────────────────────

let bridgeInstalled = false;

export function installApiBridge(): void {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  const native = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('/api/')) return native(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (cachedKey) headers.set('x-anthropic-key', cachedKey);
    if (cachedPilot) headers.set('x-jarwiz-pilot', cachedPilot);
    if (input instanceof Request) return native(new Request(apiUrl(url), input), { ...init, headers });
    return native(apiUrl(url), { ...init, headers });
  };
}
