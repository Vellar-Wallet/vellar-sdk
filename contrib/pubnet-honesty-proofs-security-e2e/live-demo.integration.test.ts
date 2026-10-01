// End-to-end payment against the demo resource on the LIVE hosted
// facilitator, testnet only.
//
// Opt-in and skipped by default — see ./vitest.config.ts and README.md. Set
// VELLAR_LIVE_X402_SECRET and VELLAR_LIVE_X402_TEST_ASSET to run it (a funded
// testnet keypair and the SAC contract id of the asset it holds).
//
// This is the opposite of local-only.ts's guard: instead of refusing anything
// but localhost, it deliberately pays a real, already publicly-cataloged demo
// resource (see reference/proofs.md) against the shared hosted facilitator.
// The one thing that must never happen is settling this against a pubnet
// network, so it is verified explicitly — on the quote and again on the
// settlement — and the payer's own network is hardcoded to "testnet" below
// rather than read from an env var that could be repointed at mainnet.
//
// The settle step fails benignly about one time in three — an empty
// `transaction` field means nothing was charged and a retry is safe (see
// packages/cli/README.md) — which is exactly what `attempts` below covers.
//
// Imports reach into packages/mcp-x402-payer/src directly: this module only
// uses its public building blocks (config, ledger, payer, signer), so it can
// live entirely inside contrib/ per the contribution rules. See README.md for
// where this belongs once lifted into core.

import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../packages/mcp-x402-payer/src/config.js";
import { createSpendLedger } from "../../packages/mcp-x402-payer/src/ledger.js";
import { createPayer, type Payer } from "../../packages/mcp-x402-payer/src/payer.js";
import { createOfficialSigner } from "../../packages/mcp-x402-payer/src/signer.js";
import {
  assertTestnetNetwork,
  readLiveIntegrationEnv,
  type LiveIntegrationEnv,
} from "./live-testnet-only.js";

const env = readLiveIntegrationEnv();

// `describe.skipIf` keeps an unconfigured machine green without pretending the
// coverage exists — the run prints the skip.
describe.skipIf(env === null)("x402 payer against the live demo resource (testnet)", () => {
  let payer: Payer;
  let ledger: ReturnType<typeof createSpendLedger>;
  let integration: LiveIntegrationEnv;

  beforeAll(() => {
    integration = env!;
    const config = loadConfig({
      VELLAR_X402_SECRET: integration.secret,
      VELLAR_X402_ASSETS: `${integration.asset}:100000000`,
      // Hardcoded, not read from the environment: this test pays a real
      // resource and must never be repointed at mainnet by a copied or
      // misconfigured env var.
      VELLAR_X402_NETWORK: "testnet",
    });
    ledger = createSpendLedger(config.ceilings);
    payer = createPayer({ config, ledger, signer: createOfficialSigner(config) });
  });

  it("quotes, pays and settles the demo resource, verified on Horizon", async () => {
    const quote = await payer.quote(integration.sellerUrl);
    expect(quote.requiresPayment).toBe(true);
    expect(quote.payable).toBe(true);
    assertTestnetNetwork(quote.selected!.network);

    const result = await payer.pay(integration.sellerUrl, quote.selected!.amount);

    expect(result.paid).toBe(true);
    expect(result.settlement).toBeDefined();
    assertTestnetNetwork(result.settlement!.network);
    expect(result.settlement!.transaction).toMatch(/^[0-9a-f]{64}$/i);
    // How many signed attempts it took — the benign ~1-in-3 empty-transaction
    // retry is expected, not a failure.
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.attempts).toBeLessThanOrEqual(3);

    // Do not just trust the facilitator's own response: independently confirm
    // the settlement landed on Horizon testnet.
    const horizonRes = await fetch(
      `https://horizon-testnet.stellar.org/transactions/${result.settlement!.transaction}`,
    );
    expect(horizonRes.ok).toBe(true);
    const tx = (await horizonRes.json()) as { successful: boolean };
    expect(tx.successful).toBe(true);
  }, 120_000);
});
