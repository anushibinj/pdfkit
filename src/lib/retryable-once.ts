/** A memoised async value whose failed attempts can be retried. */
export interface RetryableOnce<T> {
  /**
   * Start the factory on first call and return the same promise afterwards.
   * If that promise rejects, the next call starts a fresh attempt.
   */
  get(): Promise<T>;
  /** Forget the cached value so the next {@link get} starts over. */
  reset(): void;
}

/**
 * Wrap an expensive async initialiser (such as instantiating a WebAssembly
 * module) so it runs at most once at a time and only once on success.
 *
 * How the caching works, step by step:
 * 1. The first `get()` calls `factory()` and stores the returned promise.
 * 2. Concurrent and later `get()` calls receive that same stored promise, so
 *    two conversions requested back to back never download the WASM twice.
 * 3. A `.catch` handler is attached to the stored promise. If it rejects
 *    (network hiccup, CSP block, out of memory) the handler clears the cache,
 *    but only when the cache still holds *that* promise. The identity check
 *    matters: if `reset()` and a newer `get()` already replaced it, a late
 *    rejection of the old attempt must not wipe the newer one.
 * 4. Callers still see the rejection, because they hold the original promise;
 *    the internal `.catch` only exists for cleanup and swallows nothing for
 *    them.
 *
 * @param factory Creates the value. Called again only after a failure or reset.
 * @returns An object with `get` and `reset`.
 */
export function retryableOnce<T>(factory: () => Promise<T>): RetryableOnce<T> {
  let cached: Promise<T> | null = null;
  return {
    get() {
      if (cached) return cached;
      // Promise.resolve().then(...) turns a synchronous throw inside the
      // factory into a rejection, so the cleanup below also covers it.
      const attempt = Promise.resolve().then(factory);
      cached = attempt;
      attempt.catch(() => {
        if (cached === attempt) cached = null;
      });
      return attempt;
    },
    reset() {
      cached = null;
    },
  };
}
