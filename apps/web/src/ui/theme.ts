/**
 * Theme store — flips `<html data-theme>` so tokens.css can re-skin the whole
 * surface from one CSS variable swap. Default is dark (Flora-aligned night
 * canvas); light is preserved as a toggle. Persists across reloads.
 *
 * Boot order matters: `applyStoredTheme()` runs from main.tsx *before* React
 * renders so we don't get a light→dark flash on first paint.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'jz-theme';
const DEFAULT_THEME: Theme = 'dark';

const listeners = new Set<() => void>();
let current: Theme = DEFAULT_THEME;

function read(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* no storage — fall through */
  }
  return DEFAULT_THEME;
}

function write(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* non-fatal */
  }
}

function paint(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  // tldraw reads its own `tl-theme` attribute on the container; we also set
  // the legacy `data-color-mode` some builds use. Both keep tldraw shapes in
  // sync with the Jarwiz theme rather than following OS prefers-color-scheme.
  document.documentElement.setAttribute('data-color-mode', theme);
}

/** Read the stored theme and paint it onto <html>. Call once at boot. */
export function applyStoredTheme(): void {
  current = read();
  paint(current);
}

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  if (theme === current) return;
  current = theme;
  write(theme);
  paint(theme);
  listeners.forEach((l) => l());
}

export function toggleTheme(): void {
  setTheme(current === 'dark' ? 'light' : 'dark');
}

export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
