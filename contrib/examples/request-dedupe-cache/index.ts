/**
 * Request deduplication cache.
 *
 * If multiple callers request the same key while a request is already in flight,
 * all callers share the same underlying promise. Results are cached so subsequent
 * calls return the cached value.
 */

export class RequestDedupeCache<T> {
  private inFlight = new Map<string, Promise<T>>();
  private cached = new Map<string, T>();

  /**
   * Run `factory(key)` only if this key is not already in flight or cached.
   * Subsequent callers for the same key await the same in-flight promise.
   */
  async get(key: string, factory: (key: string) => Promise<T>): Promise<T> {
    if (this.cached.has(key)) {
      return this.cached.get(key)!;
    }
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key)!;
    }

    const promise = factory(key);
    this.inFlight.set(key, promise);

    // Cache the result when it resolves, and clear the in-flight marker.
    promise.then(
      (value) => {
        this.cached.set(key, value);
        this.inFlight.delete(key);
      },
      () => {
        this.inFlight.delete(key);
      },
    );

    return promise;
  }

  /** Invalidate a cached entry so the next call re-runs the factory. */
  invalidate(key: string): void {
    this.cached.delete(key);
    this.inFlight.delete(key);
  }

  /** Clear all cached and in-flight entries. */
  clear(): void {
    this.cached.clear();
    this.inFlight.clear();
  }
}