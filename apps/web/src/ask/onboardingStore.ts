/**
 * Onboarding presence flag — a tiny external store so the PromptBar's intent
 * screen can tell the rest of the chrome (the tool rail, the parked Jarwiz
 * cursor) to step aside while onboarding is up, then slide/fade back in as the
 * board opens. Same shape as sidePanelStore.
 */

let _active = false;
const _listeners = new Set<() => void>();

export function isOnboarding(): boolean {
  return _active;
}

export function setOnboarding(v: boolean): void {
  if (_active === v) return;
  _active = v;
  _listeners.forEach((cb) => cb());
}

export function subscribeOnboarding(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
