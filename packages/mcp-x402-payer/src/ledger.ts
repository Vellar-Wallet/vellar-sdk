// The cumulative per-session spend ledger — layer 1's second half.
//
// WHAT THIS IS: a guard against mistakes and runaway loops. The model supplies
// `max_amount` per call; the SERVER owns this ceiling and the model cannot
// raise it, because it is read from the environment at startup and never
// appears in any tool schema.
//
// WHAT THIS IS NOT: a security boundary. It lives in the same process the agent
// is talking to, it resets when that process restarts, and it binds only this
// server. The guarantee against a compromised or manipulated agent is the
// chain-enforced budget in a Vellar smart account, which no amount of emitted
// text can exceed. See the README — do not let this be mistaken for that.
//
// Accounting rule: spend is recorded ONLY on a confirmed settlement. Roughly one
// testnet settlement in three returns an empty transaction with nothing spent,
// so debiting per attempt would drift the ledger away from reality.

import { SessionCeilingExceededError } from "./errors.js";

export interface SpendSnapshot {
  asset: string;
  spent: string;
  ceiling: string;
  remaining: string;
}

export interface SpendLedger {
  /** Throw unless `amount` fits under this asset's remaining ceiling. */
  assertWithinCeiling(asset: string, amount: bigint): void;
  /** Record a CONFIRMED settlement. Call exactly once per settled payment. */
  record(asset: string, amount: bigint): void;
  remainingFor(asset: string): bigint;
  snapshot(): SpendSnapshot[];
  /** Returns true if shutdown has been initiated. Blocks new payments. */
  isShuttingDown(): boolean;
  /** Initiate graceful shutdown: stop accepting new calls, wait for in-flight to finish. */
  shutdown(): Promise<void>;
  /** For internal use: track when a critical section begins. */
  _trackCriticalSectionStart(): void;
  /** For internal use: track when a critical section ends. */
  _trackCriticalSectionEnd(): void;
}

/**
 * A ledger over per-asset ceilings.
 *
 * Fails CLOSED: an asset with no configured ceiling is refused outright rather
 * than treated as unlimited. Base units are only comparable within one asset, so
 * there is deliberately no cross-asset total — summing them would fail OPEN on a
 * cheaply-denominated asset.
 *
 * Supports graceful shutdown: after initiating shutdown, no new payments are
 * accepted, but in-flight payments are allowed to complete cleanly. The shutdown
 * call blocks until all in-flight critical sections have finished.
 */
export function createSpendLedger(ceilings: ReadonlyMap<string, bigint>): SpendLedger {
  const spent = new Map<string, bigint>();
  let shutdownInitiated = false;
  let inFlightCount = 0;
  let shutdownResolve: (() => void) | undefined;

  function ceilingFor(asset: string): bigint {
    const ceiling = ceilings.get(asset);
    if (ceiling === undefined) {
      // Not a configured asset ⇒ not payable. Reported as a ceiling of 0 spent
      // of 0 so the message stays uniform and still explains the refusal.
      throw new SessionCeilingExceededError(asset, 0n, 0n, 0n);
    }
    return ceiling;
  }

  function spentFor(asset: string): bigint {
    return spent.get(asset) ?? 0n;
  }

  function startCriticalSection(): void {
    inFlightCount++;
  }

  function endCriticalSection(): void {
    inFlightCount--;
    if (shutdownInitiated && inFlightCount === 0 && shutdownResolve) {
      shutdownResolve();
    }
  }

  return {
    assertWithinCeiling(asset, amount) {
      if (shutdownInitiated) {
        throw new Error("Server is shutting down and cannot accept new payments");
      }
      const ceiling = ceilingFor(asset);
      const already = spentFor(asset);
      if (already + amount > ceiling) {
        throw new SessionCeilingExceededError(asset, amount, already, ceiling);
      }
    },

    record(asset, amount) {
      // Re-resolve the ceiling so a stray record() for an unconfigured asset
      // throws rather than silently creating a new bucket.
      ceilingFor(asset);
      spent.set(asset, spentFor(asset) + amount);
    },

    remainingFor(asset) {
      const remaining = ceilingFor(asset) - spentFor(asset);
      return remaining > 0n ? remaining : 0n;
    },

    snapshot() {
      return [...ceilings.entries()].map(([asset, ceiling]) => ({
        asset,
        spent: spentFor(asset).toString(),
        ceiling: ceiling.toString(),
        remaining: (ceiling - spentFor(asset) > 0n ? ceiling - spentFor(asset) : 0n).toString(),
      }));
    },

    isShuttingDown() {
      return shutdownInitiated;
    },

    async shutdown() {
      shutdownInitiated = true;
      // If there are no in-flight critical sections, resolve immediately.
      if (inFlightCount === 0) {
        return;
      }
      // Otherwise wait for all in-flight sections to complete.
      return new Promise<void>((resolve) => {
        shutdownResolve = resolve;
      });
    },

    _trackCriticalSectionStart() {
      startCriticalSection();
    },

    _trackCriticalSectionEnd() {
      endCriticalSection();
    },
  };
}

/**
 * Serialise an async critical section.
 *
 * Two concurrent tool calls would otherwise both pass `assertWithinCeiling`
 * before either recorded, and together exceed the ceiling — a check-then-act
 * race on the very limit this module exists to enforce. It also keeps the
 * single shared x402 client's per-payment selection tripwire unambiguous.
 *
 * One key, one budget, one payment at a time.
 *
 * Supports graceful shutdown: when a ledger is provided, critical sections
 * are tracked so shutdown can wait for in-flight payments to complete.
 */
export function createMutex(ledger?: SpendLedger): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const wrappedFn = async () => {
      if (ledger) {
        ledger._trackCriticalSectionStart();
      }
      try {
        return await fn();
      } finally {
        if (ledger) {
          ledger._trackCriticalSectionEnd();
        }
      }
    };

    const result = tail.then(wrappedFn, wrappedFn);
    // Keep the chain alive regardless of this call's outcome.
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
