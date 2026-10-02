// V-9: the session ceiling must hold for every caller, not just the ones
// arriving through the MCP tool.
//
// The mutex used to wrap the x402_pay handler. `createPayer` is exported, so a
// library consumer calling `pay()` concurrently bypassed it entirely and could
// interleave assertWithinCeiling with record — the check-then-act race the
// ledger exists to prevent.

import { describe, expect, it } from "vitest";
import { createPayer } from "../src/payer.js";
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
  return async (_url: string, init?: RequestInit): Promise<Response> => {
    const paid = Boolean(init?.headers && "PAYMENT-SIGNATURE" in init.headers);
    calls.push(paid ? "paid" : "unpaid");
    await new Promise((r) => setTimeout(r, delayMs));
    return paid ? responsePaid(txHash(`tx-${calls.length}`)) : response402();
  };
}

describe("V-9 — concurrent pay() through the library cannot bust the ceiling", () => {
  it("serialises callers that never touch the MCP server", async () => {
    // Ceiling admits exactly two payments of 1000.
    const config = testConfig({ assets: `${ASSET_A}:2000` });
    const ledger = testLedger(config);
    const payer = createPayer({
      config,
      ledger,
      signer: stubSigner(),
      // A real settlement takes seconds; the delay makes the interleaving that
      // a missing lock would allow overwhelmingly likely rather than lucky.
      fetchImpl: slowFetch(25),
    });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => payer.pay(URL, "1000000")),
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

    await payer.pay(URL, "1000000");
    await payer.pay(URL, "1000000");

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

    // Over max_amount: refused before signing.
    await expect(payer.pay(URL, "1")).rejects.toThrow();
    // The next caller must still be able to acquire the lock.
    await expect(payer.pay(URL, "1000000")).resolves.toBeTruthy();
  });
});
