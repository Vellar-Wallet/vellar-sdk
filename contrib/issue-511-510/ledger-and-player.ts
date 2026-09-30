export interface SpendSnapshot {
  asset: string;
  spent: string;
  reserved: string;
  ceiling: string;
  remaining: string;
}

export interface SpendLedger {
  reserve(asset: string, amount: bigint): void;
  settle(asset: string, requestedAmount: bigint, settledAmount: bigint): void;
  release(asset: string, requestedAmount: bigint): void;
  remainingFor(asset: string): bigint;
  snapshot(): SpendSnapshot[];
}

export class SessionCeilingExceededError extends Error {
  constructor(public asset: string, public requested: bigint, public already: bigint, public ceiling: bigint) {
    super(`Session ceiling exceeded for ${asset}`);
  }
}

export function createSpendLedger(ceilings: ReadonlyMap): SpendLedger {
  const spent = new Map();
  const reserved = new Map();

  function ceilingFor(asset: string): bigint {
    const ceiling = ceilings.get(asset);
    if (ceiling === undefined) throw new SessionCeilingExceededError(asset, 0n, 0n, 0n);
    return ceiling;
  }
  function spentFor(asset: string): bigint { return spent.get(asset) ?? 0n; }
  function reservedFor(asset: string): bigint { return reserved.get(asset) ?? 0n; }

  return {
    reserve(asset, amount) {
      const ceiling = ceilingFor(asset);
      const total = spentFor(asset) + reservedFor(asset);
      if (total + amount > ceiling) {
        throw new SessionCeilingExceededError(asset, amount, total, ceiling);
      }
      reserved.set(asset, reservedFor(asset) + amount);
    },
    settle(asset, requestedAmount, settledAmount) {
      ceilingFor(asset);
      const cur = reservedFor(asset);
      reserved.set(asset, cur >= requestedAmount ? cur - requestedAmount : 0n);
      spent.set(asset, spentFor(asset) + settledAmount);
    },
    release(asset, requestedAmount) {
      ceilingFor(asset);
      const cur = reservedFor(asset);
      reserved.set(asset, cur >= requestedAmount ? cur - requestedAmount : 0n);
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
    }
  };
}

// --- payer.ts & cli.ts Example Implementation (#510) ---
export interface PaymentResult {
  authorizedCeiling: bigint;
  actuallySettled: bigint;
}

export function printPaymentResult(result: PaymentResult) {
  console.log(`✅ Payment complete.`);
  console.log(`   Authorized Ceiling: ${result.authorizedCeiling.toString()}`);
  console.log(`   Actually Settled:   ${result.actuallySettled.toString()}`);
}