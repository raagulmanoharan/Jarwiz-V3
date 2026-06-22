/**
 * Help + onboarding state. Two surfaces share one tiny external store:
 *
 *  - the **help panel** (reference: what Jarwiz can do + shortcuts), toggled
 *    from the topbar's "?" button, and
 *  - the **guided tour** (a step-by-step walkthrough of the features), launched
 *    from the panel or auto-shown once on first run.
 *
 * "Seen the tour" is persisted in localStorage so the walkthrough auto-opens
 * exactly once; the panel and tour are always replayable on demand.
 */

const TOUR_SEEN_KEY = 'jz-tour-seen';
const listeners = new Set<() => void>();

interface HelpState {
  /** The reference help panel is open. */
  panelOpen: boolean;
  /** Active guided-tour step index, or null when the tour isn't running. */
  tourStep: number | null;
}

let state: HelpState = { panelOpen: false, tourStep: null };

function set(next: Partial<HelpState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function subscribeHelp(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getHelpState(): HelpState {
  return state;
}

export function openHelp(): void {
  set({ panelOpen: true, tourStep: null });
}
export function closeHelp(): void {
  set({ panelOpen: false });
}
export function toggleHelp(): void {
  set({ panelOpen: !state.panelOpen, tourStep: null });
}

/** Launch the guided tour from the start (closes the panel). */
export function startTour(): void {
  set({ panelOpen: false, tourStep: 0 });
}
/** Jump to a specific step (the layer clamps to its own step count). */
export function setTourStep(n: number): void {
  set({ tourStep: n });
}
/** End the tour and remember it's been seen. */
export function endTour(): void {
  markTourSeen();
  set({ tourStep: null });
}

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return true; // no storage → don't nag every load
  }
}
export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    /* non-fatal */
  }
}
