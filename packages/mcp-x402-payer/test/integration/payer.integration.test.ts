// End-to-end payment against a LOCAL facilitator and a LOCAL seller.
//
// Excluded from the default suite (see vitest.config.ts) and run with
// `npm run test:integration`. Requires all four of:
//
//   VELLAR_X402_FACILITATOR_URL   e.g. http://127.0.0.1:3000
//   VELLAR_X402_SELLER_URL        e.g. http://127.0.0.1:4021/paid
//   VELLAR_X402_SECRET            an S… secret funded with the test asset
//   VELLAR_X402_TEST_ASSET        the SAC contract id of that asset
//
// The endpoints are checked against the localhost guard before anything runs —
// see ./local-only.ts for why that is enforced in code.
//
// These tests make REAL payments on testnet. They are slow (each attempt costs a
// ledger read, a Horizon query and two simulations) and the settle step fails
// benignly about one time in three, which is exactly what `retries` covers.

import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createSpendLedger } from "../../src/ledger.js";
import { createPayer, type Payer } from "../../src/payer.js";
import { createOfficialSigner } from "../../src/signer.js";
import { readIntegrationEnv, type IntegrationEnv } from "./local-only.js";

const env = readIntegrationEnv();

// `describe.skipIf` keeps an unconfigured machine green without pretending the
// coverage exists — the run prints the skip.
describe.skipIf(env === null)("x402 payer against a local stack", () => {
  let payer: Payer;
  let config: ReturnType<typeof loadConfig>;
  let ledger: ReturnType<typeof createSpendLedger>;
  let integration: IntegrationEnv;

  beforeAll(() => {
    integration = env!;
    config = loadConfig({
      VELLAR_X402_SECRET: integration.secret,
      // A generous session ceiling: these tests exercise the payment path, not
      // the limiter (that is covered hermetically in payer.test.ts).
      VELLAR_X402_ASSETS: `${integration.asset}:100000000`,
      VELLAR_X402_NETWORK: "testnet",
    });
    ledger = createSpendLedger(config.ceilings);
    payer = createPayer({ config, ledger, signer: createOfficialSigner(config) });
  });

  it("quotes the resource without spending anything", async () => {
    const quote = await payer.quote(integration.sellerUrl);

    expect(quote.requiresPayment).toBe(true);
    expect(quote.selected?.asset).toBe(integration.asset);
    expect(quote.payable).toBe(true);
    // A quote must not move the ledger.
    expect(ledger.remainingFor(integration.asset)).toBe(100_000_000n);
  }, 30_000);

  it("pays the resource and returns a real settlement hash", async () => {
    const before = ledger.remainingFor(integration.asset);
    const quote = await payer.quote(integration.sellerUrl);
    const price = BigInt(quote.selected!.amount);

    const result = await payer.pay(integration.sellerUrl, quote.selected!.amount);

    expect(result.paid).toBe(true);
    expect(result.settlement?.transaction).toMatch(/^[0-9a-f]{64}$/i);
    expect(result.content.text ?? "").not.toBe("");
    // Debited exactly the price, exactly once, regardless of how many attempts
    // the settle step needed.
    expect(ledger.remainingFor(integration.asset)).toBe(before - price);
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.attempts).toBeLessThanOrEqual(3);
  }, 120_000);

  it("refuses to pay above max_amount against the real seller", async () => {
    const quote = await payer.quote(integration.sellerUrl);
    const under = (BigInt(quote.selected!.amount) - 1n).toString();
    const before = ledger.remainingFor(integration.asset);

    await expect(payer.pay(integration.sellerUrl, under)).rejects.toThrow(/exceeds maxAmount/);
    expect(ledger.remainingFor(integration.asset)).toBe(before);
  }, 30_000);
});
