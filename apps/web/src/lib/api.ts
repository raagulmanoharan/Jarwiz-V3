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

let cachedKey: string | null = readStoredKey();
const listeners = new Set<() => void>();

function readStoredKey(): string | null {
  try {
    return window.localStorage.getItem(KEY_STORAGE);
  } catch {
    return null; // storage blocked (private mode) — key just won't persist
  }
}

export function subscribeApiKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getApiKey(): string | null {
  return cachedKey;
}

export function setApiKey(key: string | null): void {
  cachedKey = key?.trim() || null;
  try {
    if (cachedKey) window.localStorage.setItem(KEY_STORAGE, cachedKey);
    else window.localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage blocked — the key still works for this tab's lifetime */
  }
  for (const listener of listeners) listener();
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
    if (input instanceof Request) return native(new Request(apiUrl(url), input), { ...init, headers });
    return native(apiUrl(url), { ...init, headers });
  };
}
