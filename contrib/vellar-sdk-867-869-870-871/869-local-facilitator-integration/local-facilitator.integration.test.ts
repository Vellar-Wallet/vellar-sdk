// Worked quote-and-pay integration test against a locally run vellar-facilitator
// (issue #869). Excluded from the default suite by vitest.config.ts because it
// needs a real local stack. See README.md for the one-command startup and the
// environment variables.
//
// This suite NEVER targets the hosted facilitator: the first settlement for a
// resource URL writes a permanent public catalog entry.

import { beforeAll, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { createX402Client, type FetchLike } from "../../../src/x402-client.js";
import { probeFacilitator, readLocalFacilitatorEnv } from "./preflight.js";

const env = readLocalFacilitatorEnv();
const skipReason =
  env === null
    ? "set VELLAR_LOCAL_FACILITATOR_URL, VELLAR_X402_SELLER_URL, VELLAR_X402_RPC_URL, " +
      "VELLAR_X402_SECRET and VELLAR_X402_TEST_ASSET"
    : await probeFacilitator(env.facilitatorUrl);

const title = skipReason === null
  ? "SDK x402 client against a local facilitator"
  : `SDK x402 client against a local facilitator (skipped: ${skipReason})`;

describe.skipIf(skipReason !== null)(title, () => {
  let client: ReturnType<typeof createX402Client>;
  let capturedHeaders: Record<string, string> | undefined;

  const capturingFetch: FetchLike = async (url, init) => {
    capturedHeaders = {};
    if (init?.headers) {
      const headers =
        init.headers instanceof Headers
          ? init.headers
          : new Headers(init.headers as Record<string, string>);
      headers.forEach((value, key) => {
        capturedHeaders![key] = value;
      });
    }
    return fetch(url, init);
  };

  beforeAll(() => {
    const keypair = Keypair.fromSecret(env!.secret);
    client = createX402Client({
      signer: {
        address: keypair.publicKey(),
        async signAuthEntry(xdr: string) {
          const { signature } = keypair.sign(Buffer.from(xdr, "base64"));
          return Buffer.from(signature).toString("base64");
        },
      },
      rpcUrl: env!.rpcUrl,
      network: "testnet",
      simulationSourceAccount: keypair.publicKey(),
      fetchImpl: capturingFetch,
    });
  });

  it(
    "quotes the 402 challenge, then pays it and verifies the settlement hash",
    async () => {
      // The 402 response is the quote: it advertises the accepted payment
      // requirements before anything is signed.
      const challenge = await fetch(env!.sellerUrl);
      expect(challenge.status).toBe(402);
      expect(challenge.headers.get("content-type")).toContain("application/json");

      const result = await client.fetch(env!.sellerUrl, { maxAmount: 10_000_000n });
      expect(result.paid).toBe(true);
      expect(result.response.status).toBe(200);
      expect(result.settlement?.transaction).toMatch(/^[0-9a-f]{64}$/i);
      expect(capturedHeaders?.["PAYMENT-SIGNATURE"]).toBeDefined();
    },
    120_000,
  );

  it(
    "refuses an over-budget quote without sending a payment signature",
    async () => {
      capturedHeaders = undefined;
      await expect(client.fetch(env!.sellerUrl, { maxAmount: 0n })).rejects.toThrow(
        /exceeds maxAmount|MaxAmountExceeded/,
      );
      expect(capturedHeaders?.["PAYMENT-SIGNATURE"]).toBeUndefined();
    },
    30_000,
  );
});
