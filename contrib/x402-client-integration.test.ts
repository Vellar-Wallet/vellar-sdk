// Integration test for the SDK x402 client path against a LOCAL facilitator
// (issue #439).
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
import { createX402Client, type FetchLike } from "../src/x402-client";
import type { SmartAccountX402Signer } from "../src/x402-types";
import { Keypair } from "@stellar/stellar-sdk";

// ── localhost guard ──────────────────────────────────────────────────────────
// Reuse the same logic as the MCP payer's local-only.ts. Inlined here so the
// contrib test is self-contained and does not depend on a package-internal path.

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function isLocalUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(host)) return true;
  if (/^127\.\d{1,3}\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host.endsWith(".localhost")) return true;
  return false;
}

function assertLocalEndpoints(endpoints: Record<string, string>): void {
  for (const [name, url] of Object.entries(endpoints)) {
    if (!isLocalUrl(url)) {
      throw new Error(
        `${name} points at ${url}, which is not localhost. Integration tests refuse ` +
          `to run against a non-local facilitator or seller: the first settlement for a ` +
          `resource URL writes a PERMANENT public catalog entry that cannot be deleted.`,
      );
    }
  }
}

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
        async signAuthEntry(xdr: string) {
          const { signature } = kp.sign(Buffer.from(xdr, "base64"));
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
      const first = await fetch(integration.sellerUrl);
      expect(first.status).toBe(402);

      const result = await client.fetch(integration.sellerUrl, {
        maxAmount: 10_000_000n,
      });

      expect(result.paid).toBe(true);
      expect(result.response.status).toBe(200);
      expect(result.settlement?.transaction).toMatch(/^[0-9a-f]{64}$/i);
      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!["PAYMENT-SIGNATURE"]).toBeDefined();
    },
    120_000,
  );

  it(
    "refuses over-maxAmount without sending a payment signature",
    async () => {
      capturedHeaders = undefined;

      await expect(
        client.fetch(integration.sellerUrl, { maxAmount: 0n }),
      ).rejects.toThrow(/exceeds maxAmount|MaxAmountExceeded/);

      expect(capturedHeaders?.["PAYMENT-SIGNATURE"]).toBeUndefined();
    },
    30_000,
  );
});