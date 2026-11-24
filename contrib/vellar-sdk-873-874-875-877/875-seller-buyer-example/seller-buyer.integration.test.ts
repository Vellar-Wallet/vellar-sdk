// Worked seller and SDK buyer example against a locally run facilitator
// (issue #875). Opt-in and excluded from the default suite by vitest.config.ts.
// See README.md for the one-command facilitator startup and environment.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { createX402Client } from "../../../src/x402-client.js";
import { createSellerServer, listenSeller } from "./seller.mjs";
import { probeFacilitator, readSellerBuyerEnv } from "./preflight.js";

const env = readSellerBuyerEnv();
const skipReason =
  env === null
    ? "set VELLAR_LOCAL_FACILITATOR_URL, VELLAR_X402_RPC_URL, VELLAR_X402_SECRET and VELLAR_X402_TEST_ASSET"
    : await probeFacilitator(env.facilitatorUrl);

const title = skipReason === null
  ? "minimal seller paired with the SDK buyer flow"
  : `minimal seller paired with the SDK buyer flow (skipped: ${skipReason})`;

describe.skipIf(skipReason !== null)(title, () => {
  let keypair: Keypair;
  let seller: ReturnType<typeof createSellerServer>;
  let sellerUrl: string;
  let client: ReturnType<typeof createX402Client>;

  beforeAll(async () => {
    keypair = Keypair.fromSecret(env!.secret);
    seller = createSellerServer({
      asset: env!.asset,
      payTo: keypair.publicKey(),
    });
    const port = await listenSeller(seller);
    sellerUrl = `http://127.0.0.1:${port}/paid`;
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
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      seller.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("discovers the challenge through the seller, then pays it with the SDK", async () => {
    const challenge = await fetch(sellerUrl);
    expect(challenge.status).toBe(402);
    expect(challenge.headers.get("PAYMENT-REQUIRED")).toBeTruthy();

    const result = await client.fetch(sellerUrl, { maxAmount: 10_000_000n });
    expect(result.paid).toBe(true);
    expect(result.response.status).toBe(200);
    expect(result.settlement?.transaction).toMatch(/^[0-9a-f]{64}$/i);
  }, 120_000);
});
