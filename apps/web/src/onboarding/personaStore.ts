/**
 * Who is standing at the composer — the one-tap identity from the intent
 * screen's "What brings you here?" chips. It tunes the first-run experience
 * (starter prompts, the composer's self-typing examples, the ambient scene's
 * cards) and persists across boards, so future surfaces (seed pills, Ultra
 * Think) can speak to the same person without asking again.
 *
 * `null` = unchosen or "just exploring" — the generic experience. Never a
 * gate: everything works identically without a pick.
 */

export type Persona = 'product' | 'research' | 'design';

const KEY = 'jarwiz-persona';

let _persona: Persona | null = readStored();
/** Whether the user has actively answered (incl. "just exploring", stored as
 *  'none') — the ask-once gate for the persona modal. */
let _chosen = hasStored();
const _listeners = new Set<() => void>();

function hasStored(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

function readStored(): Persona | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'product' || v === 'research' || v === 'design' ? v : null;
  } catch {
    return null;
  }
}

export function getPersona(): Persona | null {
  return _persona;
}

export function hasChosenPersona(): boolean {
  return _chosen;
}

export function setPersona(p: Persona | null): void {
  _chosen = true;
  _persona = p;
  try {
    // 'none' persists the "just exploring" answer, so the ask-once modal
    // never nags a returning visitor who already skipped it.
    localStorage.setItem(KEY, p ?? 'none');
  } catch {
    /* private mode — session-only is fine */
  }
  _listeners.forEach((cb) => cb());
}

/** Forget the answer entirely — the fresh-start entry (?start=1) re-arms the
 *  ask-once modal so "Try it free" always opens with the question, even for a
 *  visitor who answered (or skipped) it on an earlier visit. */
export function resetPersona(): void {
  _chosen = false;
  _persona = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode — session-only is fine */
  }
  _listeners.forEach((cb) => cb());
}

export function subscribePersona(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
