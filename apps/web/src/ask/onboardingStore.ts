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
 * - `canvasEngaged` — the user clicked or dragged on the BOARD itself. Sticky
 *   for the life of the intent screen: the scene's illustrative cards look
 *   real enough to try to select (owner hit this — a marquee around them
 *   selects nothing), so the first touch of the canvas retires the movie
 *   rather than letting it drift back and mislead again.
 */

let _active = false;
let _engaged = false;
let _canvasEngaged = false;
const _listeners = new Set<() => void>();

export function isOnboarding(): boolean {
  return _active;
}

export function setOnboarding(v: boolean): void {
  if (_active === v) return;
  _active = v;
  // A future brand-new board gets its welcome scene back.
  if (!v) _canvasEngaged = false;
  _listeners.forEach((cb) => cb());
}

export function isOnboardingEngaged(): boolean {
  return _engaged || _canvasEngaged;
}

export function setOnboardingCanvasEngaged(): void {
  if (_canvasEngaged) return;
  _canvasEngaged = true;
  _listeners.forEach((cb) => cb());
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
