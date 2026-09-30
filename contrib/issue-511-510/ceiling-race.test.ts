import { describe, expect, it } from "vitest";
import { createSpendLedger } from "./ledger-and-payer.js";

const ASSET_A = "USDC";

describe("In-flight Reservation & Settlement (#511)", () => {
  it("prevents concurrent payments from exceeding the ceiling via reservations", () => {
    const ceilings = new Map([[ASSET_A, 5_000_000n]]);
    const ledger = createSpendLedger(ceilings);

    ledger.reserve(ASSET_A, 3_000_000n);
    expect(() => ledger.reserve(ASSET_A, 3_000_000n)).toThrowError();

    // Settle for only a fraction of the requested ceiling
    ledger.settle(ASSET_A, 3_000_000n, 10_000n);

    // Reservation released, remaining budget allows the next request
    expect(() => ledger.reserve(ASSET_A, 3_000_000n)).not.toThrow();
    ledger.settle(ASSET_A, 3_000_000n, 3_000_000n);
    
    expect(ledger.remainingFor(ASSET_A)).toBe(1_990_000n);
  });
  
  it("releases reservations cleanly on network failure", () => {
    const ceilings = new Map([[ASSET_A, 100n]]);
    const ledger = createSpendLedger(ceilings);

    ledger.reserve(ASSET_A, 100n);
    expect(ledger.remainingFor(ASSET_A)).toBe(0n);
    
    ledger.release(ASSET_A, 100n); 
    expect(ledger.remainingFor(ASSET_A)).toBe(100n);
  });
});