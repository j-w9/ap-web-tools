/**
 * Key-value persistence (upstream uses `localStorage`/`sessionStorage` directly). Storage access
 * can throw in private modes; the port treats that as "nothing stored" instead of crashing.
 */
export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

/** Wraps a `Storage` (resolved lazily, so a throwing accessor is also contained). */
export function webStore(storage: () => Storage): KeyValueStore {
  return {
    get(key) {
      try {
        return storage().getItem(key)
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        storage().setItem(key, value)
      } catch {
        /* Storage unavailable: setting is not persisted. */
      }
    },
    remove(key) {
      try {
        storage().removeItem(key)
      } catch {
        /* Storage unavailable. */
      }
    }
  }
}

/** In-memory store, for tests and environments without Web Storage. */
export function memoryStore(
  initial: Readonly<Record<string, string>> = {}
): KeyValueStore & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key)
  }
}
