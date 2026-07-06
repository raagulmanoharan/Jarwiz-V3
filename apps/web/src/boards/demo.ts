/**
 * Demo mode — when the app is opened with `?demo=1` (how the marketing site
 * embeds it), the board is pre-seeded with a representative SWOT board so a
 * first-time visitor lands on a full canvas, not a blank one, and the new-board
 * dialog is suppressed. See boards/demoSeed.ts.
 */

export function isDemo(): boolean {
  return hasParam('demo');
}

/** Minified embed (?embed=1) — the marketing hero's live preview: just the
 *  canvas + a lightweight composer, all other chrome hidden. Typing or tapping
 *  a suggestion spawns a card client-side (no server needed). */
export function isEmbed(): boolean {
  return hasParam('embed');
}

function hasParam(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has(key);
  } catch {
    return false;
  }
}
