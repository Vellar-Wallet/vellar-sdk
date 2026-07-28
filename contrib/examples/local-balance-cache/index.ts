/**
 * Small balance cache keyed by account + token, with a configurable expiry.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number; // epoch ms
}

export interface BalanceCacheOptions {
  /** Expiry in milliseconds. Default: 5,000. */
  ttlMs?: number;
}

export class LocalBalanceCache {
  private store = new Map<string, CacheEntry<bigint>>();
  private ttlMs: number;

  constructor(opts?: BalanceCacheOptions) {
    this.ttlMs = opts?.ttlMs ?? 5000;
  }

  key(account: string, token: string): string {
    return `${account}\u0001${token}`;
  }

  set(account: string, token: string, value: bigint): void {
    const expiresAt = Date.now() + this.ttlMs;
    this.store.set(this.key(account, token), { value, expiresAt });
  }

  get(account: string, token: string): bigint | undefined {
    const entry = this.store.get(this.key(account, token));
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(this.key(account, token));
      return undefined;
    }
    return entry.value;
  }

  invalidate(account: string, token: string): void {
    this.store.delete(this.key(account, token));
  }

  clear(): void {
    this.store.clear();
  }
}