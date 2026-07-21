/**
 * Help state — a tiny external store behind the reference help panel (what
 * Jarwiz can do + keyboard shortcuts), toggled from the rail's "?" button.
 *
 * (There used to be a guided tour here too; it was removed once it had gone
 * stale and undiscoverable — the panel carries the reference on its own.)
 */

const listeners = new Set<() => void>();

interface HelpState {
  /** The reference help panel is open. */
  panelOpen: boolean;
}

let state: HelpState = { panelOpen: false };

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

export function closeHelp(): void {
  set({ panelOpen: false });
}
export function toggleHelp(): void {
  set({ panelOpen: !state.panelOpen });
}
