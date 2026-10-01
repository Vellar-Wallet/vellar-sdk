// Integration test for the SDK x402 client path against a LOCAL facilitator.
//
// Excluded from the default suite (vitest.config.ts excludes *.integration.test.ts)
// and run only with `npm run test:integration`.
//
// Requires a locally-running facilitator and seller. Set these environment variables:
//
//   VELLAR_X402_FACILITATOR_URL   e.g. http://127.0.0.1:3000
//   VELLAR_X402_SELLER_URL        e.g. http://127.0.0.1:4021/paid
//   VELLAR_X402_RPC_URL           e.g. https://soroban-testnet.stellar.org
//   VELLAR_X402_SECRET            an S… secret key funded with the test asset
//   VELLAR_X402_TEST_ASSET        the SAC contract id of the payment asset
//
// The endpoints are checked against the localhost guard before anything runs.
// NEVER point these at the hosted facilitator — the first settlement for a
// resource URL writes a permanent public catalog entry that cannot be deleted.

import { beforeAll, describe, expect, it } from "vitest";
import { createX402Client, type FetchLike } from "./x402-client";
import type { SmartAccountX402Signer } from "./x402-types";
import { Keypair } from "@stellar/stellar-sdk";
import {
  assertLocalEndpoints,
  isLocalUrl,
} from "../packages/mcp-x402-payer/test/integration/local-only";

// ── environment ─────────────────────────────────────────────────────────────

interface Env {
  facilitatorUrl: string;
  sellerUrl: string;
  rpcUrl: string;
  secret: string;
  asset: string;
}

function readEnv(): Env | null {
  const facilitatorUrl = process.env.VELLAR_X402_FACILITATOR_URL?.trim();
  const sellerUrl = process.env.VELLAR_X402_SELLER_URL?.trim();
  const rpcUrl = process.env.VELLAR_X402_RPC_URL?.trim();
  const secret = process.env.VELLAR_X402_SECRET?.trim();
  const asset = process.env.VELLAR_X402_TEST_ASSET?.trim();

  const set = [facilitatorUrl, sellerUrl, rpcUrl, secret, asset].filter(Boolean).length;
  if (set === 0) return null;
  if (set < 5) {
    throw new Error(
      "Integration environment is only partially set. Provide ALL of " +
        "VELLAR_X402_FACILITATOR_URL, VELLAR_X402_SELLER_URL, VELLAR_X402_RPC_URL, " +
        "VELLAR_X402_SECRET and VELLAR_X402_TEST_ASSET, or none of them.",
    );
  }

  // Reuse the existing localhost guard — never write a second, weaker version.
  assertLocalEndpoints({
    VELLAR_X402_FACILITATOR_URL: facilitatorUrl!,
    VELLAR_X402_SELLER_URL: sellerUrl!,
  });

  return {
    facilitatorUrl: facilitatorUrl!,
    sellerUrl: sellerUrl!,
    rpcUrl: rpcUrl!,
    secret: secret!,
    asset: asset!,
  };
}

const env = readEnv();

// ── test suite ──────────────────────────────────────────────────────────────

describe.skipIf(env === null)("x402 client against a local facilitator", () => {
  let client: ReturnType<typeof createX402Client>;
  let kp: Keypair;
  let integration: Env;
  let capturedHeaders: Record<string, string> | undefined;

  // A fetch that proxies through the facilitator URL and captures request
  // headers for assertion.
  const capturingFetch: FetchLike = async (url, init) => {
    capturedHeaders = {};
    if (init?.headers) {
      const h =
        init.headers instanceof Headers
          ? init.headers
          : new Headers(init.headers as Record<string, string>);
      h.forEach((v, k) => {
        capturedHeaders![k] = v;
      });
    }
    return fetch(url, init);
  };

  beforeAll(() => {
    integration = env!;
    kp = Keypair.fromSecret(integration.secret);

    client = createX402Client({
      signer: {
        address: kp.publicKey(),
        async signAuthEntry(xdr: string, opts: { networkPassphrase: string; expirationLedger: number }) {
          // The SDK's x402-client builds the auth entry; we sign the raw XDR
          // with the keypair. This mirrors what a real wallet signer does.
          const { hash, signature } = kp.sign(
            Buffer.from(
              // The x402-client passes base64 XDR; the signer signs the raw
              // hash of the payload (SEP-41 auth entry).
              // For integration testing, we use the keypair's sign method
              // which signs the SHA-256 hash of the data.
              xdr,
              "base64",
            ),
          );
          // Return the signed XDR — the facilitator will verify against the
          // public key.
          return Buffer.from(signature).toString("base64");
        },
      },
      rpcUrl: integration.rpcUrl,
      network: "testnet",
      simulationSourceAccount: kp.publicKey(),
      fetchImpl: capturingFetch,
    });
  });

  it(
    "covers a full settlement: challenge → guard → sign → settle",
    async () => {
      // 1. Probe the seller — should get a 402 with a PAYMENT-REQUIRED header.
      const first = await fetch(integration.sellerUrl);
      expect(first.status).toBe(402);

      // 2. Use the SDK client to pay. The client handles:
      //    - decoding the challenge
      //    - selecting requirements (guard clearance)
      //    - building and signing the auth entry
      //    - retrying with the PAYMENT-SIGNATURE header
      const result = await client.fetch(integration.sellerUrl, {
        maxAmount: 10_000_000n,
      });

      // 3. The paid response should be 200 with a settlement hash.
      expect(result.paid).toBe(true);
      expect(result.response.status).toBe(200);
      expect(result.settlement?.transaction).toMatch(/^[0-9a-f]{64}$/i);

      // 4. The payment signature header was sent on the retry.
      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!["PAYMENT-SIGNATURE"]).toBeDefined();
    },
    120_000,
  );

  it(
    "refuses over-maxAmount without sending a payment signature",
    async () => {
      // The guard should reject before signing, so no PAYMENT-SIGNATURE
      // header is ever sent. We set maxAmount to 0 to guarantee the refusal.
      capturedHeaders = undefined;

      await expect(
        client.fetch(integration.sellerUrl, { maxAmount: 0n }),
      ).rejects.toThrow(/exceeds maxAmount|MaxAmountExceeded/);

      // No payment signature should have been sent — the guard rejected
      // before the signing step.
      expect(capturedHeaders?.["PAYMENT-SIGNATURE"]).toBeUndefined();
    },
    30_000,
  );
});