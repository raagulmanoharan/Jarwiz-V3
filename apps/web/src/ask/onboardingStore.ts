/**
 * Onboarding presence flags — a tiny external store so the PromptBar's intent
 * screen can tell the rest of the chrome (the tool rail, the parked Jarwiz
 * cursor, the ambient scene) how to behave while onboarding is up, then
 * slide/fade back in as the board opens. Same shape as sidePanelStore.
 *
 * - `active`  — the intent screen is up (a brand-new empty board). Gates the
 *   tool rail / parked cursor stepping aside, and mounts the ambient scene.
 * - `engaged` — the user has focused or started typing in the composer. The
 *   ambient scene hushes on this the MOMENT you engage, before the first send.
 */

let _active = false;
let _engaged = false;
const _listeners = new Set<() => void>();

export function isOnboarding(): boolean {
  return _active;
}

export function setOnboarding(v: boolean): void {
  if (_active === v) return;
  _active = v;
  _listeners.forEach((cb) => cb());
}

export function isOnboardingEngaged(): boolean {
  return _engaged;
}

export function setOnboardingEngaged(v: boolean): void {
  if (_engaged === v) return;
  _engaged = v;
  _listeners.forEach((cb) => cb());
}

export function subscribeOnboarding(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
