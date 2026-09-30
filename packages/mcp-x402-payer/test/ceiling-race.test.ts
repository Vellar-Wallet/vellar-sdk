import { describe, expect, it } from "vitest";
import { MaxAmountExceededError } from "../src/errors.js";
import { createPayer } from "../src/payer.js";
import { createSpendLedger } from "../src/ledger.js";
import { SessionCeilingExceededError } from "../src/errors.js";
import {
  ASSET_A,
  response402,
  responsePaid,
  stubSigner,
  testConfig,
  testLedger,
  txHash,
} from "./helpers.js";

const URL = "https://res.test/paid";

/** A fetch that answers every request, with a delay to widen the race window. */
function slowFetch(delayMs: number) {
  const calls: string[] = [];
  return async (_url: string, init?: RequestInit): Promise => {
    const paid = Boolean(init?.headers && "PAYMENT-SIGNATURE" in init.headers);
    calls.push(paid ? "paid" : "unpaid");
    await new Promise((r) => setTimeout(r, delayMs));
    return paid ? responsePaid(txHash(`tx-${calls.length}`)) : response402();
  };
}

describe("V-9 — concurrent pay() through the library cannot bust the ceiling", () => {
  it("serialises callers that never touch the MCP server", async () => {
    const config = testConfig({ assets: `${ASSET_A}:2000` });
    const ledger = testLedger(config);
    const payer = createPayer({
      config,
      ledger,
      signer: stubSigner(),
      fetchImpl: slowFetch(25),
    });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => payer.pay(URL, "1000")), // Assumes these settle at 1000 each
    );

    const settled = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");

    expect(settled).toHaveLength(2);
    expect(refused).toHaveLength(4);
    expect(ledger.remainingFor(ASSET_A)).toBe(0n);
  });

  it("does not double-count when calls do not overlap", async () => {
    const config = testConfig({ assets: `${ASSET_A}:5000` });
    const ledger = testLedger(config);
    const payer = createPayer({
      config,
      ledger,
      signer: stubSigner(),
      fetchImpl: slowFetch(1),
    });

    await payer.pay(URL, "1000");
    await payer.pay(URL, "1000");

    // Two 1000 requests settled for 1000
    expect(ledger.remainingFor(ASSET_A)).toBe(3000n);
  });

  it("keeps working after a rejected payment — the lock is not poisoned", async () => {
    const config = testConfig({ assets: `${ASSET_A}:2000` });
    const ledger = testLedger(config);
    const payer = createPayer({
      config,
      ledger,
      signer: stubSigner(),
      fetchImpl: slowFetch(1),
    });

    // Price (1000) above max_amount (500): refused before signing. This has to
    // be a genuine refusal — the test previously passed only because a broken
    // payer threw a TypeError that `rejects.toThrow()` swallowed.
    await expect(payer.pay(URL, "500")).rejects.toBeInstanceOf(MaxAmountExceededError);
    // The next caller must still be able to acquire the lock.
    await expect(payer.pay(URL, "1000")).resolves.toBeTruthy();
  });
});

describe("In-flight Reservation & Settlement (#511)", () => {
  it("prevents concurrent payments from exceeding the ceiling via reservations", () => {
    // 5 USDC session ceiling
    const ceilings = new Map([[ASSET_A, 5_000_000n]]);
    const ledger = createSpendLedger(ceilings);

    // Two concurrent upto requests for 3 USDC each. 
    // 3 + 3 = 6 (exceeds 5 USDC ceiling)
    ledger.reserve(ASSET_A, 3_000_000n);
    
    expect(() => ledger.reserve(ASSET_A, 3_000_000n)).toThrowError(SessionCeilingExceededError);

    // Request 1 settles for only 0.01 USDC (an upto payment utilizing less than requested)
    ledger.settle(ASSET_A, 3_000_000n, 10_000n);

    // Now the available budget is 4.99 USDC. 
    // Request 2 tries again and should now pass.
    expect(() => ledger.reserve(ASSET_A, 3_000_000n)).not.toThrow();
    
    // Request 2 utilizes its full 3 USDC
    ledger.settle(ASSET_A, 3_000_000n, 3_000_000n);
    
    // Total spent: 3.01 USDC. Remaining: 1.99 USDC.
    expect(ledger.remainingFor(ASSET_A)).toBe(1_990_000n);
  });
  
  it("releases reservations cleanly on network failure", () => {
    const ceilings = new Map([[ASSET_A, 100n]]);
    const ledger = createSpendLedger(ceilings);

    ledger.reserve(ASSET_A, 100n);
    expect(ledger.remainingFor(ASSET_A)).toBe(0n);
    
    // Simulate failed payment
    ledger.release(ASSET_A, 100n); 
    expect(ledger.remainingFor(ASSET_A)).toBe(100n);
  });
});