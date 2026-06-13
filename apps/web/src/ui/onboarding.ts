/**
 * First-run state — has the user summoned (or dismissed the nudge) yet?
 * Persisted in localStorage so the coachmark teaches ⌘K exactly once. Tiny
 * external store so both the hint and the palette can flip it.
 */

const KEY = 'jz-onboarded';
const listeners = new Set<() => void>();

let onboarded = readInitial();

function readInitial(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false; // private mode / no storage — just show the hint this session
  }
}

export function markOnboarded(): void {
  if (onboarded) return;
  onboarded = true;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* non-fatal */
  }
  listeners.forEach((l) => l());
}

export function subscribeOnboarded(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getOnboarded(): boolean {
  return onboarded;
}
