/**
 * Fresh-start entry (?start=1) — how the marketing site's "Try it free" CTA
 * opens the app. The promise of that button is the first-run experience: the
 * intent screen with the "What brings you here?" ask floating over the live
 * ambient scene. A first-time visitor gets that anyway; this module makes it
 * deterministic for everyone — a returning visitor (including one who explored
 * the old ?demo=1 seeded board) gets a brand-new empty board and is asked
 * again, while every board they already have stays untouched in the switcher.
 *
 * Must run before React renders (called from main.tsx): the active board
 * feeds tldraw's persistenceKey at first paint, so the switch has to happen
 * pre-mount. The `start` param is then stripped from the URL so a refresh
 * continues on the (now used) board instead of stacking a new one per reload.
 */

import { createBoard, getActiveBoard } from './boardStore';
import { isDemo, isEmbed, isFreshStart, isUseCases } from './demo';
import { resetPersona } from '../onboarding/personaStore';

export function handleFreshStart(): void {
  if (!isFreshStart()) return;
  // The showcase modes own their canvas — a stray combined param defers to them.
  if (isDemo() || isEmbed() || isUseCases()) return;
  // A fresh start IS a first run: re-arm the ask-once "What brings you here?".
  resetPersona();
  // A brand-new board arms the intent screen; only a visitor whose active
  // board is already in use needs a fresh one.
  if (!getActiveBoard()?.isNew) createBoard();
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('start');
    window.history.replaceState(null, '', url);
  } catch {
    /* best effort — worst case a reload starts fresh again */
  }
}
