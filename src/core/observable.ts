/**
 * Shared observable primitive (DESIGN §5.1). Pure — no I/O.
 */

export type Disposable = () => void;

export interface Observable<T> {
  get(): T;
  subscribe(cb: (v: T) => void): Disposable;
}

export interface MutableObservable<T> extends Observable<T> {
  set(v: T): void;
}

/** In-memory observable for config/state and tests. */
export function createObservable<T>(initial: T): MutableObservable<T> {
  let value = initial;
  const listeners = new Set<(v: T) => void>();

  return {
    get(): T {
      return value;
    },
    set(v: T): void {
      value = v;
      for (const cb of listeners) {
        cb(v);
      }
    },
    subscribe(cb: (v: T) => void): Disposable {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
