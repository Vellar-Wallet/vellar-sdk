// SDK-level integration test: the FULL x402 payment path driven by the SDK's
// OWN client (createX402Client + createSessionKeySigner), run end-to-end
// against a local stack and checked on-chain against the smart account's
// spending-limit policy.
//
// This is the counterpart to layer2.integration.test.ts, which drives the same
// on-chain-policy claim but through the MCP payer's @x402/core scheme client.
// Here the payment is authorized and checked against signer policy using the
// SDK's own fetch client + V1 signer:
//
//   A. a payment WITHIN the on-chain policy cap  -> authorizes and settles
//   B. a payment VIOLATING  the on-chain policy cap -> rejected by the chain
//
// What makes B meaningful: maxAmount is set ABOVE the over-cap price for both
// calls, so no client-side guard refuses B. The only thing left that can reject
// it is the wallet contract's __check_auth invoking the policy — the chain.
//
// Requires the same provisioned smart account + local stack as
// layer2.integration.test.ts (see the package README "Integration tests"),
// plus a funded classic account for the SDK's simulation source:
//
//   VELLAR_X402_FACILITATOR_URL   http://127.0.0.1:4100
//   VELLAR_X402_SELLER_URL        the UNDER-cap seller (e.g. http://127.0.0.1:4031/quote)
//   VELLAR_X402_SELLER_OVERCAP_URL the OVER-cap seller
//   VELLAR_X402_SECRET            the session-key secret (S...) attached to the wallet
//   VELLAR_X402_TEST_ASSET        the SAC contract id
//   VELLAR_X402_WALLET            the smart-account C-address that pays
//   VELLAR_X402_POLICIES          the spending-limit policy contract ids it requires
//   VELLAR_X402_SIM_SOURCE        a funded classic G-account, used only to simulate
//   VELLAR_X402_RPC_URL           (optional) Soroban RPC; defaults to soroban-testnet

import { beforeAll, describe, expect, it } from "vitest";
import { createSessionKeySigner, createX402Client, PaymentRejectedError } from "vellar-sdk";
import { assertLocalEndpoints } from "./local-only.js";

const HORIZON = "https://horizon-testnet.stellar.org";
const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";

const env = {
  facilitator: process.env.VELLAR_X402_FACILITATOR_URL,
  under: process.env.VELLAR_X402_SELLER_URL,
  over: process.env.VELLAR_X402_SELLER_OVERCAP_URL,
  secret: process.env.VELLAR_X402_SECRET,
  asset: process.env.VELLAR_X402_TEST_ASSET,
  wallet: process.env.VELLAR_X402_WALLET,
  policies: process.env.VELLAR_X402_POLICIES,
  simSource: process.env.VELLAR_X402_SIM_SOURCE,
  rpcUrl: process.env.VELLAR_X402_RPC_URL?.trim() || DEFAULT_RPC_URL,
};
const configured = Object.values(env).every((v) => v !== undefined && v !== "");

if (configured) {
  assertLocalEndpoints({
    VELLAR_X402_FACILITATOR_URL: env.facilitator!,
    VELLAR_X402_SELLER_URL: env.under!,
    VELLAR_X402_SELLER_OVERCAP_URL: env.over!,
  });
}

// A ceiling deliberately ABOVE both seller prices, so neither call is refused
// by the client-side maxAmount guard — only the on-chain policy can refuse B.
// (The provisioned sellers are priced at 1,000,000 base units, like layer 2.)
const MAX_AMOUNT = 100_000_000n;

describe.skipIf(!configured)("SDK x402 client — payment against signer policy", () => {
  // The field is assigned in beforeAll once the (skipped) describe is entered.
  let client: ReturnType<typeof createX402Client>;

  beforeAll(() => {
    const signer = createSessionKeySigner({
      address: env.wallet!,
      secretKey: env.secret!,
      policies: env.policies!.split(",").map((p) => p.trim()).filter(Boolean),
    });
    client = createX402Client({
      signer,
      rpcUrl: env.rpcUrl!,
      network: "testnet",
      simulationSourceAccount: env.simSource!,
    });
  }, 30_000);

  it("authorizes and settles a payment within the policy cap", async () => {
    const { paid, settlement, response } = await client.fetch(env.under!, {
      maxAmount: MAX_AMOUNT,
    });

    expect(paid).toBe(true);
    expect(settlement?.transaction).toMatch(/^[0-9a-f]{64}$/);
    expect(settlement?.payer).toBe(env.wallet);
    expect(settlement?.asset).toBe(env.asset);

    // The unlocked body is fenced as resource data (the seller's own framing).
    const text = await response.text();
    expect(text).toMatch(/BEGIN UNTRUSTED RESOURCE DATA/);

    // Verified on chain, not taken from the response.
    const tx = await fetch(`${HORIZON}/transactions/${settlement!.transaction}`);
    expect(tx.ok, `Horizon did not find ${settlement!.transaction}`).toBe(true);
    expect(((await tx.json()) as { successful: boolean }).successful).toBe(true);
  }, 180_000);

  it("rejects a payment that violates the on-chain policy cap", async () => {
    await expect(client.fetch(env.over!, { maxAmount: MAX_AMOUNT })).rejects.toBeInstanceOf(
      PaymentRejectedError,
    );
    // The facilitator refused because the wallet contract rejected it — the
    // on-chain policy being enforced. Nothing was settled.
  }, 180_000);
});
