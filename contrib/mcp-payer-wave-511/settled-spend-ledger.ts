import { SessionCeilingExceededError } from "../../packages/mcp-x402-payer/src/errors.js";

export interface SettledSpendLedger {
  reserve(asset: string, requestedAmount: bigint): void;
  settle(asset: string, requestedAmount: bigint, settledAmount: bigint): void;
  release(asset: string, requestedAmount: bigint): void;
  remainingFor(asset: string): bigint;
}

export function createSettledSpendLedger(
  ceilings: ReadonlyMap<string, bigint>,
): SettledSpendLedger {
  const spent = new Map<string, bigint>();
  const reserved = new Map<string, bigint>();

  function ceilingFor(asset: string): bigint {
    const ceiling = ceilings.get(asset);
    if (ceiling === undefined) {
      throw new SessionCeilingExceededError(asset, 0n, 0n, 0n);
    }
    return ceiling;
  }

  function amountForOperation(amount: bigint): void {
    if (amount < 0n) {
      throw new RangeError("Spend amounts cannot be negative.");
    }
  }

  return {
    reserve(asset, requestedAmount) {
      amountForOperation(requestedAmount);
      const ceiling = ceilingFor(asset);
      const currentSpent = spent.get(asset) ?? 0n;
      const currentReserved = reserved.get(asset) ?? 0n;

      if (currentSpent + currentReserved + requestedAmount > ceiling) {
        throw new SessionCeilingExceededError(
          asset,
          requestedAmount,
          currentSpent + currentReserved,
          ceiling,
        );
      }

      reserved.set(asset, currentReserved + requestedAmount);
    },

    settle(asset, requestedAmount, settledAmount) {
      amountForOperation(requestedAmount);
      amountForOperation(settledAmount);
      ceilingFor(asset);
      if (settledAmount > requestedAmount) {
        throw new RangeError("Settled amount cannot exceed its reservation.");
      }

      const currentReserved = reserved.get(asset) ?? 0n;
      if (currentReserved < requestedAmount) {
        throw new RangeError("Cannot settle more budget than is reserved.");
      }

      reserved.set(asset, currentReserved - requestedAmount);
      spent.set(asset, (spent.get(asset) ?? 0n) + settledAmount);
    },

    release(asset, requestedAmount) {
      amountForOperation(requestedAmount);
      ceilingFor(asset);

      const currentReserved = reserved.get(asset) ?? 0n;
      if (currentReserved < requestedAmount) {
        throw new RangeError("Cannot release more budget than is reserved.");
      }

      reserved.set(asset, currentReserved - requestedAmount);
    },

    remainingFor(asset) {
      const remaining =
        ceilingFor(asset) - (spent.get(asset) ?? 0n) - (reserved.get(asset) ?? 0n);
      return remaining > 0n ? remaining : 0n;
    },
  };
}