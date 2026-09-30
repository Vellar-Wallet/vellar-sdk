// Integration test for the SDK x402 path (wallet.x402.fetch).
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
// see packages/mcp-x402-payer/test/integration/local-only.ts for why that is
// enforced in code.
//
// WHAT MUST BE RUNNING LOCALLY:
//   1. A vellar-facilitator instance on VELLAR_X402_FACILITATOR_URL
//   2. A test seller on VELLAR_X402_SELLER_URL that returns 402 with x402
//      payment requirements and serves paid content after settlement
//   3. A funded Stellar testnet account at the secret key VELLAR_X402_SECRET,
//      holding the token at VELLAR_X402_TEST_ASSET
//
// These tests make REAL payments on testnet. They are slow and the settle step
// fails benignly about one time in three (see x402-guards.ts:isRetryableSettleFailure).

import { beforeAll, describe, expect, it } from "vitest";
import { createX402Client, type FetchLike } from "./x402-client";
import { assertLocalEndpoints } from "../packages/mcp-x402-payer/test/integration/local-only";
import type { SmartAccountX402Signer } from "./x402-types";
import { CAIP2_BY_NETWORK, NETWORKS } from "./x402-guards";

// ── environment ─────────────────────────────────────────────────────────────

function readEnv() {
  const facilitatorUrl = process.env.VELLAR_X402_FACILITATOR_URL?.trim();
  const sellerUrl = process.env.VELLAR_X402_SELLER_URL?.trim();
  const secret = process.env.VELLAR_X402_SECRET?.trim();
  const asset = process.env.VELLAR_X402_TEST_ASSET?.trim();

  const set = [facilitatorUrl, sellerUrl, secret, asset].filter(Boolean).length;
  if (set === 0) return null;
  if (set < 4) {
    throw new Error(
      "Integration environment is only partially set. Provide ALL of " +
        "VELLAR_X402_FACILITATOR_URL, VELLAR_X402_SELLER_URL, VELLAR_X402_SECRET and " +
        "VELLAR_X402_TEST_ASSET, or none of them.",
    );
  }

  assertLocalEndpoints({
    VELLAR_X402_FACILITATOR_URL: facilitatorUrl!,
    VELLAR_X402_SELLER_URL: sellerUrl!,
  });

  return {
    facilitatorUrl: facilitatorUrl!,
    sellerUrl: sellerUrl!,
    secret: secret!,
    asset: asset!,
  };
}

const env = readEnv();

// ── signer (ed25519 via @stellar/stellar-sdk) ───────────────────────────────

async function createTestSigner(secret: string): Promise<{
  signer: SmartAccountX402Signer;
  simulationSourceAccount: string;
}> {
  // Dynamic import to avoid pulling stellar-sdk into the hermetic suite.
  const { Keypair } = await import("@stellar/stellar-sdk");
  const kp = Keypair.fromSecret(secret);
  return {
    signer: {
      address: kp.publicKey(),
      async signAuthEntry(entryXdr: string, opts: { networkPassphrase: string; expirationLedger: number }) {
        const { hash, TransactionBuilder, xdr: x } = await import("@stellar/stellar-sdk");
        const entry = x.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64");
        const credentials = entry.credentials().address();
        credentials.signatureExpirationLedger(opts.expirationLedger);
        const payload = hash(
          TransactionBuilder.buildInvocationTransaction(
            credentials.address(),
            credentials.nonce(),
            opts.networkPassphrase,
            entry.rootInvocation(),
          ),
        );
        const sig = kp.sign(payload);
        credentials.signature(x.ScVal.scvBytes(sig));
        entry.credentials().address(credentials);
        return entry.toXDR("base64");
      },
    },
    simulationSourceAccount: kp.publicKey(),
  };
}

// ── test suite ──────────────────────────────────────────────────────────────

describe.skipIf(env === null)("SDK x402 path against a local facilitator", () => {
  let client: ReturnType<typeof createX402Client>;
  let sellerUrl: string;
  let asset: string;
  let maxAmount: bigint;

  beforeAll(async () => {
    const e = env!;
    const { signer, simulationSourceAccount } = await createTestSigner(e.secret);

    client = createX402Client({
      signer,
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      simulationSourceAccount,
    });

    sellerUrl = e.sellerUrl;
    asset = e.asset;
    maxAmount = 10_000_000n;
  });

  it("full settlement: challenge → guard → sign → retry → confirmed hash", async () => {
    const result = await client.fetch(sellerUrl, {
      maxAmount,
      allowedAssets: [asset],
    });

    expect(result.paid).toBe(true);
    expect(result.settlement).toBeDefined();
    expect(result.settlement!.transaction).toMatch(/^[0-9a-f]{64}$/i);
    expect(result.settlement!.asset).toBe(asset);
    expect(result.response.status).toBe(200);

    // The response body should contain the paid content.
    const body = await result.response.text();
    expect(body.length).toBeGreaterThan(0);
  }, 120_000);

  it("refusal: over-maxAmount costs nothing and sends no payment signature", async () => {
    // Use a maxAmount of 1 — any real resource will cost more than that.
    const fetchSpy: FetchLike = async (url, init) => {
      // Verify no PAYMENT-SIGNATURE header was sent on the first request.
      const headers = new Headers(init?.headers);
      if (headers.has("PAYMENT-SIGNATURE") || headers.has("payment-signature")) {
        throw new Error("payment signature header was sent on a request that should have been rejected before signing");
      }
      return globalThis.fetch(url, init);
    };

    const clientWithSpy = createX402Client({
      signer: (await createTestSigner(env!.secret)).signer,
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      simulationSourceAccount: (await createTestSigner(env!.secret)).simulationSourceAccount,
      fetchImpl: fetchSpy,
    });

    const result = await clientWithSpy.fetch(sellerUrl, {
      maxAmount: 1n, // absurdly low — forces a MaxAmountExceededError
      allowedAssets: [asset],
    });

    // The client should refuse before signing, so no payment was made.
    expect(result.paid).toBe(false);
    // The response should still be the 402 (the client didn't pay).
    expect(result.response.status).toBe(402);
  }, 30_000);
});