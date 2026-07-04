/**
 * One tiny external store to replace the ten hand-rolled copies of the same
 * listeners/emit/subscribe pattern scattered across the app (docs/AUDIT.md
 * P2.3). Immutable snapshots — `set` replaces the value, so it's safe to hand
 * straight to useSyncExternalStore.
 */
export interface ExternalStore<T> {
  get(): T;
  set(next: T): void;
  /** Convenience for map/set-style state: derive the next value from the current. */
  update(fn: (current: T) => T): void;
  subscribe(cb: () => void): () => void;
}

export function createExternalStore<T>(initial: T): ExternalStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((cb) => cb());
    },
    update(fn) {
      this.set(fn(value));
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
