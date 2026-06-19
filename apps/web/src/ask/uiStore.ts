/**
 * A minimal external store holding a single optional value, read via
 * useSyncExternalStore. Several ephemeral UI states — the streaming draft, an
 * in-place regeneration, a pending clarifying question — each need the same
 * subscribe/get/set/update/clear plumbing. This factory is that plumbing, so a
 * store is a few lines instead of copy-pasted boilerplate.
 */

export interface UiStore<T> {
  subscribe(cb: () => void): () => void;
  get(): T | null;
  set(next: T | null): void;
  /** Shallow-merge a patch into the current value (no-op if unset). */
  update(patch: Partial<T>): void;
  clear(): void;
}

export function createUiStore<T>(): UiStore<T> {
  let state: T | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((cb) => cb());
  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    get: () => state,
    set(next) {
      state = next;
      emit();
    },
    update(patch) {
      if (state === null) return;
      state = { ...state, ...patch };
      emit();
    },
    clear() {
      if (state === null) return;
      state = null;
      emit();
    },
  };
}
