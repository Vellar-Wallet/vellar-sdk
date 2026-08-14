// LAYER 2 — the demonstration that makes "the agent cannot exceed its budget" a
// checkable claim rather than a description.
//
// Two payments through the REAL MCP protocol against a policy-governed Vellar
// smart account, with a spending-limit policy enforced on-chain inside
// `__check_auth`:
//
//   A. UNDER the on-chain cap  -> settles; hash verified on Horizon
//   B. OVER  the on-chain cap  -> refused by the wallet contract; nothing spent
//
// What makes B meaningful: this server's OWN limits are set deliberately ABOVE
// the on-chain cap for both calls, so no process-level guard can be what refuses
// B. `max_amount` and the session ceiling both exceed the over-cap amount. The
// only thing left that can refuse is the chain.
//
// Requires a provisioned smart account (see the README) plus a local facilitator
// and two sellers — one priced under the cap, one over.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLocalEndpoints } from "./local-only.js";

const HORIZON = "https://horizon-testnet.stellar.org";
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin.js");

const env = {
  secret: process.env.VELLAR_X402_SECRET,
  wallet: process.env.VELLAR_X402_WALLET,
  policy: process.env.VELLAR_X402_POLICIES,
  asset: process.env.VELLAR_X402_TEST_ASSET,
  underUrl: process.env.VELLAR_X402_SELLER_URL,
  overUrl: process.env.VELLAR_X402_SELLER_OVERCAP_URL,
};
const configured = Object.values(env).every(Boolean);

if (configured) {
  assertLocalEndpoints({
    VELLAR_X402_SELLER_URL: env.underUrl!,
    VELLAR_X402_SELLER_OVERCAP_URL: env.overUrl!,
  });
}

describe.skipIf(!configured)("layer 2 — the chain enforces the budget", () => {
  let client: Client;
  const textOf = (r: unknown) =>
    ((r as { content?: Array<{ text?: string }> }).content ?? [])
      .map((c) => c.text ?? "")
      .join("\n");

  beforeAll(async () => {
    expect(existsSync(BIN), `built server missing at ${BIN} — run npm run build`).toBe(true);
    client = new Client({ name: "layer2-integration", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [BIN],
        env: {
          PATH: process.env.PATH ?? "",
          VELLAR_X402_SECRET: env.secret!,
          VELLAR_X402_WALLET: env.wallet!,
          VELLAR_X402_POLICIES: env.policy!,
          // Deliberately far above the on-chain cap. If a process-level guard
          // refused B, this test would prove nothing.
          VELLAR_X402_ASSETS: `${env.asset}:100000000`,
          VELLAR_X402_NETWORK: "testnet",
        },
        stderr: "pipe",
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  it("pays from the smart account, and the settlement is real", async () => {
    const res = await client.callTool({
      name: "x402_pay",
      arguments: { resource_url: env.underUrl!, max_amount: "10000000" },
    });
    const text = textOf(res);

    expect(res.isError ?? false, text).toBe(false);
    const hash = text.match(/Settlement transaction: ([0-9a-f]{64})/)?.[1];
    expect(hash, `no settlement hash in:\n${text}`).toBeDefined();

    // Verified on chain, not taken from the response.
    const tx = await fetch(`${HORIZON}/transactions/${hash}`);
    expect(tx.ok, `Horizon did not find ${hash}`).toBe(true);
    expect(((await tx.json()) as { successful: boolean }).successful).toBe(true);
  }, 180_000);

  it("is refused by the CHAIN when the payment exceeds the on-chain cap", async () => {
    const before = textOf(await client.callTool({ name: "x402_session_budget", arguments: {} }));

    const res = await client.callTool({
      name: "x402_pay",
      arguments: { resource_url: env.overUrl!, max_amount: "10000000" },
    });
    const text = textOf(res);

    expect(res.isError).toBe(true);
    // The wallet contract refused, via the policy it invoked.
    expect(text).toMatch(/spending policy attached to the signing key REFUSED/);
    expect(text).toMatch(/on-chain budget being enforced/);
    // Nothing settled.
    expect(text).not.toMatch(/Settlement transaction: [0-9a-f]{64}/);

    // And no process-level guard was involved — the session ledger is untouched,
    // which is what distinguishes "the chain refused" from "we refused".
    const after = textOf(await client.callTool({ name: "x402_session_budget", arguments: {} }));
    expect(after).toBe(before);
  }, 180_000);

  it("tells the model that retrying bigger will not help", async () => {
    // A budget refusal that reads as transient invites exactly the wrong retry.
    const res = await client.callTool({
      name: "x402_pay",
      arguments: { resource_url: env.overUrl!, max_amount: "10000000" },
    });
    expect(textOf(res)).toMatch(/no retry or larger max_amount will change that/);
  }, 180_000);
});
