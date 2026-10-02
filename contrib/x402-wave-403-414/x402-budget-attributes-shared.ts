import type {
  BudgetAttributeRule,
  BudgetAttributeTracker,
} from "../../src/x402-budget-attributes";

/**
 * Pluggable key-value store interface for shared-state budget tracking.
 * Compatible with localStorage, IndexedDB, Redis, or custom server stores.
 */
export interface BudgetAttributeStore {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

/**
 * Thrown when an underlying key-value store fails or is unavailable during
 * budget tracking operations. Fails CLOSED (refuses payment) for security.
 */
export class BudgetAttributeStoreUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `Budget attribute store is unavailable: ${
        cause instanceof Error ? cause.message : String(cause)
      }. Failing CLOSED to prevent unbudgeted payments.`,
    );
    this.name = "BudgetAttributeStoreUnavailableError";
    (this as any).cause = cause;
  }
}

export interface SharedStateBudgetAttributeTrackerOptions {
  keyPrefix?: string;
  periodKey?: string;
}

export interface SharedStateBudgetAttributeTracker extends BudgetAttributeTracker {
  runExclusively<T>(fn: () => Promise<T>): Promise<T>;
}

function createTrackerMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn, fn);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

/**
 * Creates a {@link BudgetAttributeTracker} backed by an injectable key-value store.
 *
 * Ensures check-then-record atomic operations using an async mutex to prevent
 * parallel payment race conditions. Fails CLOSED (throws {@link BudgetAttributeStoreUnavailableError})
 * whenever the underlying store fails or is unavailable.
 */
export function createSharedStateBudgetAttributeTracker(
  store: BudgetAttributeStore,
  options: SharedStateBudgetAttributeTrackerOptions = {},
): SharedStateBudgetAttributeTracker {
  const keyPrefix = options.keyPrefix ?? "x402_budget";
  const periodKey = options.periodKey ?? "all_time";
  const mutex = createTrackerMutex();

  function getStoreKey(rule: BudgetAttributeRule): string {
    const category = rule.category ?? "*";
    return `${keyPrefix}:${periodKey}:${rule.merchant}:${category}`;
  }

  async function safeGetItem(key: string): Promise<string | null> {
    try {
      return await store.getItem(key);
    } catch (err) {
      throw new BudgetAttributeStoreUnavailableError(err);
    }
  }

  async function safeSetItem(key: string, value: string): Promise<void> {
    try {
      await store.setItem(key, value);
    } catch (err) {
      throw new BudgetAttributeStoreUnavailableError(err);
    }
  }

  return {
    async spent(rule: BudgetAttributeRule): Promise<bigint> {
      return mutex(async () => {
        const key = getStoreKey(rule);
        const raw = await safeGetItem(key);
        if (!raw) return 0n;
        try {
          return BigInt(raw);
        } catch (err) {
          throw new BudgetAttributeStoreUnavailableError(err);
        }
      });
    },

    async record(rule: BudgetAttributeRule, amount: bigint): Promise<void> {
      return mutex(async () => {
        const key = getStoreKey(rule);
        const raw = await safeGetItem(key);
        let current = 0n;
        if (raw) {
          try {
            current = BigInt(raw);
          } catch (err) {
            throw new BudgetAttributeStoreUnavailableError(err);
          }
        }
        const next = current + amount;
        await safeSetItem(key, next.toString());
      });
    },

    async runExclusively<T>(fn: () => Promise<T>): Promise<T> {
      return mutex(fn);
    },
  };
}
