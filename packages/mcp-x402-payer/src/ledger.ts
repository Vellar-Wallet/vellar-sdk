import { SessionCeilingExceededError } from "./errors.js";

export interface SpendSnapshot {
  asset: string;
  spent: string;
  reserved: string;
  ceiling: string;
  remaining: string;
}

export interface SpendLedger {
  /** 
   * Phase 1: Attempt to reserve budget for an in-flight payment. 
   * Throws if `amount` exceeds the remaining ceiling (including other active reservations).
   */
  reserve(asset: string, amount: bigint): void;
  
  /** 
   * Phase 2 (Success): Record a CONFIRMED settlement. 
   * Drops the initial reservation and permanently deducts the actual settled amount.
   */
  settle(asset: string, requestedAmount: bigint, settledAmount: bigint): void;

  /** 
   * Phase 2 (Failure): Release a reservation if the payment failed or was cancelled.
   */
  release(asset: string, requestedAmount: bigint): void;

  remainingFor(asset: string): bigint;
  snapshot(): SpendSnapshot[];
}

/**
 * A ledger over per-asset ceilings with in-flight reservation support.
 *
 * Fails CLOSED: an asset with no configured ceiling is refused outright rather
 * than treated as unlimited.
 */
export function createSpendLedger(ceilings: ReadonlyMap): SpendLedger {
  const spent = new Map();
  const reserved = new Map();

  function ceilingFor(asset: string): bigint {
    const ceiling = ceilings.get(asset);
    if (ceiling === undefined) {
      // Not a configured asset ⇒ not payable.
      throw new SessionCeilingExceededError(asset, 0n, 0n, 0n);
    }
    return ceiling;
  }

  function spentFor(asset: string): bigint {
    return spent.get(asset) ?? 0n;
  }

  function reservedFor(asset: string): bigint {
    return reserved.get(asset) ?? 0n;
  }

  return {
    reserve(asset, amount) {
      const ceiling = ceilingFor(asset);
      const alreadySpent = spentFor(asset);
      const alreadyReserved = reservedFor(asset);
      
      if (alreadySpent + alreadyReserved + amount > ceiling) {
        throw new SessionCeilingExceededError(asset, amount, alreadySpent + alreadyReserved, ceiling);
      }
      
      reserved.set(asset, alreadyReserved + amount);
    },

    settle(asset, requestedAmount, settledAmount) {
      ceilingFor(asset);
      
      const currentReserved = reservedFor(asset);
      // Floor at 0 to defend against underflow if a caller bypassed reserve()
      reserved.set(asset, currentReserved >= requestedAmount ? currentReserved - requestedAmount : 0n);
      
      spent.set(asset, spentFor(asset) + settledAmount);
    },

    release(asset, requestedAmount) {
      ceilingFor(asset);
      
      const currentReserved = reservedFor(asset);
      reserved.set(asset, currentReserved >= requestedAmount ? currentReserved - requestedAmount : 0n);
    },

    remainingFor(asset) {
      const remaining = ceilingFor(asset) - (spentFor(asset) + reservedFor(asset));
      return remaining > 0n ? remaining : 0n;
    },

    snapshot() {
      return [...ceilings.entries()].map(([asset, ceiling]) => {
        const s = spentFor(asset);
        const r = reservedFor(asset);
        return {
          asset,
          spent: s.toString(),
          reserved: r.toString(),
          ceiling: ceiling.toString(),
          remaining: (ceiling - (s + r) > 0n ? ceiling - (s + r) : 0n).toString(),
        };
      });
    },
  };
}

/**
 * Serialise an async critical section.
 *
 * Keeps the single shared x402 client's per-payment selection tripwire unambiguous.
 * One key, one budget, one payment at a time.
 */
export function createMutex(): (fn: () => Promise) => Promise {
  let tail: Promise = Promise.resolve();

  return function run(fn: () => Promise): Promise {
    const result = tail.then(fn, fn);
    // Keep the chain alive regardless of this call's outcome.
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}