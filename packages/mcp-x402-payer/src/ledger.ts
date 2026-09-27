// The cumulative per-session spend ledger — layer 1's second half.
//
// WHAT THIS IS: a guard against mistakes and runaway loops. The model supplies
// `max_amount` per call; the SERVER owns this ceiling and the model cannot
// raise it, because it is read from the environment at startup and never
// appears in any tool schema.
//
// WHAT THIS IS NOT: a security boundary. It lives in the same process the agent
// is talking to, and by default it resets when that process restarts (unless
// VELLAR_X402_LEDGER_FILE is configured for durable persistence across restarts).
// The guarantee against a compromised or manipulated agent is the
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

/**
 * Pluggable durable store seam for persisting ledger spend state across process restarts.
 */
export interface DurableLedgerStore {
  load(): Promise<Record<string, string>> | Record<string, string>;
  save(snapshot: Record<string, string>): Promise<void> | void;
}

export class DurableLedgerStoreError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DurableLedgerStoreError";
  }
}

export interface SpendLedgerOptions {
  store?: DurableLedgerStore;
  initialSpent?: Record<string, string>;
}

export interface SpendLedger {
  /** Throw unless `amount` fits under this asset's remaining ceiling. */
  assertWithinCeiling(asset: string, amount: bigint): void;
  /** Record a CONFIRMED settlement. Call exactly once per settled payment. */
  record(asset: string, amount: bigint): Promise<void> | void;
  remainingFor(asset: string): bigint;
  snapshot(): SpendSnapshot[];
}

/**
 * Creates a {@link DurableLedgerStore} backed by a JSON file on disk.
 */
export function createFileLedgerStore(filePath: string): DurableLedgerStore {
  return {
    async load(): Promise<Record<string, string>> {
      const { readFile } = await import("node:fs/promises");
      try {
        const text = await readFile(filePath, "utf8");
        return JSON.parse(text);
      } catch (err: any) {
        if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
          return {};
        }
        throw new DurableLedgerStoreError(
          `Could not load durable spend ledger from ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err,
        );
      }
    },

    async save(snapshot: Record<string, string>): Promise<void> {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      try {
        const dir = dirname(filePath);
        if (dir && dir !== ".") {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
      } catch (err) {
        throw new DurableLedgerStoreError(
          `Could not save durable spend ledger to ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err,
        );
      }
    },
  };
}

/**
 * A ledger over per-asset ceilings.
 *
 * Fails CLOSED: an asset with no configured ceiling is refused outright rather
 * than treated as unlimited. Base units are only comparable within one asset, so
 * there is deliberately no cross-asset total — summing them would fail OPEN on a
 * cheaply-denominated asset.
 */
export function createSpendLedger(
  ceilings: ReadonlyMap<string, bigint>,
  options?: SpendLedgerOptions | DurableLedgerStore,
): SpendLedger {
  const store = options && "save" in options ? options : (options as SpendLedgerOptions)?.store;
  const initialSpent = options && "initialSpent" in options ? (options as SpendLedgerOptions).initialSpent : undefined;

  const spent = new Map<string, bigint>();

  if (initialSpent) {
    for (const [asset, val] of Object.entries(initialSpent)) {
      try {
        spent.set(asset, BigInt(val));
      } catch {
        // Ignore malformed individual entries defensively
      }
    }
  }

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

  function currentSnapshotRecord(): Record<string, string> {
    const rec: Record<string, string> = {};
    for (const [asset, amount] of spent.entries()) {
      rec[asset] = amount.toString();
    }
    return rec;
  }

  return {
    assertWithinCeiling(asset, amount) {
      const ceiling = ceilingFor(asset);
      const already = spentFor(asset);
      if (already + amount > ceiling) {
        throw new SessionCeilingExceededError(asset, amount, already, ceiling);
      }
    },

    async record(asset, amount) {
      ceilingFor(asset);
      const nextAmount = spentFor(asset) + amount;
      spent.set(asset, nextAmount);

      if (store) {
        try {
          await store.save(currentSnapshotRecord());
        } catch (err) {
          throw new DurableLedgerStoreError(
            `Failed to persist spend ledger snapshot: ${
              err instanceof Error ? err.message : String(err)
            }`,
            err,
          );
        }
      }
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
  };
}

/**
 * Async helper to instantiate a SpendLedger pre-populated with persisted state
 * loaded from a {@link DurableLedgerStore}.
 */
export async function createDurableSpendLedger(
  ceilings: ReadonlyMap<string, bigint>,
  store: DurableLedgerStore,
): Promise<SpendLedger> {
  let initialSpent: Record<string, string> = {};
  try {
    initialSpent = await store.load();
  } catch (err) {
    throw new DurableLedgerStoreError(
      `Failed to load initial spend ledger state: ${
        err instanceof Error ? err.message : String(err)
      }`,
      err,
    );
  }
  return createSpendLedger(ceilings, { store, initialSpent });
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
 */
export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn, fn);
    // Keep the chain alive regardless of this call's outcome.
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
