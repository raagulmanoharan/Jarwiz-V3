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
/** Whether the user has actively answered (incl. picking "just exploring"),
 *  so the chips can show a settled state rather than re-prompting. */
let _chosen = _persona !== null;
const _listeners = new Set<() => void>();

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
  if (_persona !== p) {
    _persona = p;
    try {
      if (p) localStorage.setItem(KEY, p);
      else localStorage.removeItem(KEY);
    } catch {
      /* private mode — session-only is fine */
    }
  }
  _listeners.forEach((cb) => cb());
}

export function subscribePersona(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
