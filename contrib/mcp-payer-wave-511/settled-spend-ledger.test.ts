import { describe, expect, it } from "vitest";
import { SessionCeilingExceededError } from "../../packages/mcp-x402-payer/src/errors.js";
import { createSettledSpendLedger } from "./settled-spend-ledger.js";

const ASSET = "USDC";

describe("settled spend ledger (#511)", () => {
  it("counts in-flight reservations against concurrent payments", () => {
    const ledger = createSettledSpendLedger(new Map([[ASSET, 5_000_000n]]));

    ledger.reserve(ASSET, 3_000_000n);
    expect(ledger.remainingFor(ASSET)).toBe(2_000_000n);
    expect(() => ledger.reserve(ASSET, 3_000_000n)).toThrow(
      SessionCeilingExceededError,
    );
  });

  it("replaces the reservation with the confirmed settled amount", () => {
    const ledger = createSettledSpendLedger(new Map([[ASSET, 5_000_000n]]));

    ledger.reserve(ASSET, 3_000_000n);
    ledger.settle(ASSET, 3_000_000n, 10_000n);

    expect(ledger.remainingFor(ASSET)).toBe(4_990_000n);
    expect(() => ledger.reserve(ASSET, 3_000_000n)).not.toThrow();
  });

  it("releases the reservation when payment fails", () => {
    const ledger = createSettledSpendLedger(new Map([[ASSET, 100n]]));

    ledger.reserve(ASSET, 100n);
    expect(ledger.remainingFor(ASSET)).toBe(0n);

    ledger.release(ASSET, 100n);
    expect(ledger.remainingFor(ASSET)).toBe(100n);
  });

  it("rejects settlements larger than the reserved request", () => {
    const ledger = createSettledSpendLedger(new Map([[ASSET, 100n]]));
    ledger.reserve(ASSET, 50n);

    expect(() => ledger.settle(ASSET, 50n, 51n)).toThrow(RangeError);
    expect(ledger.remainingFor(ASSET)).toBe(50n);
  });
});