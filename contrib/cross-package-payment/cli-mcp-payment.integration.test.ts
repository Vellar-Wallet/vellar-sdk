import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePayCommand } from "../../packages/cli/src/commands/pay";
import type { PayerConfig } from "../../packages/mcp-x402-payer/src/config";
import { createSpendLedger } from "../../packages/mcp-x402-payer/src/ledger";
import { payAndCall } from "../../packages/mcp-x402-payer/src/pay-and-call";
import type { Payer } from "../../packages/mcp-x402-payer/src/payer";

vi.mock("@x402/core/client", () => ({
  x402Client: class {
    register() {
      return this;
    }

    async createPaymentPayload() {
      return { x402Version: 2, payload: { transaction: "mock-xdr" } };
    }
  },
}));

vi.mock("@x402/core/http", () => ({
  x402HTTPClient: class {
    encodePaymentSignatureHeader() {
      return { "PAYMENT-SIGNATURE": "mock-signature" };
    }
  },
}));

vi.mock("@x402/stellar/exact/client", () => ({ ExactStellarScheme: class {} }));
vi.mock("@x402/stellar", () => ({ createEd25519Signer: () => ({}) }));

const RESOURCE = "https://demo-resource.test/report";
const FACILITATOR = "https://mock-facilitator.test";
const ASSET = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const PAY_TO = "G".padEnd(56, "A");
const AMOUNT = "1250000";
const TRANSACTION = "d".repeat(64);
const NETWORK = "stellar:testnet";

function base64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function challengeResponse(): Response {
  return new Response("payment required", {
    status: 402,
    headers: {
      "payment-required": base64Json({
        x402Version: 2,
        resource: { url: RESOURCE, description: "Demo report" },
        accepts: [
          {
            scheme: "exact",
            network: NETWORK,
            amount: AMOUNT,
            asset: ASSET,
            payTo: PAY_TO,
            maxTimeoutSeconds: 120,
            extra: { areFeesSponsored: true },
          },
        ],
      }),
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const integration = process.env.VELLAR_CROSS_PACKAGE_INTEGRATION === "1" ? describe : describe.skip;

integration("CLI and MCP payer settlement parity", () => {
  // These are independent payment paths used by different consumers. Comparing
  // them against one deterministic resource catches drift in amount reporting,
  // transaction shape, and MCP spend accounting before it reaches users.
  it("reports the same amount and transaction shape for equivalent inputs", async () => {
    const cliFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          settlement: { transaction: TRANSACTION, amount: AMOUNT, asset: ASSET },
        }),
      );
    vi.stubGlobal("fetch", cliFetch);
    const cliOutput: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => cliOutput.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args) => cliOutput.push(args.join(" ")));

    await makePayCommand().parseAsync([
      "node",
      "pay",
      RESOURCE,
      "--secret",
      Keypair.random().secret(),
      "--max",
      AMOUNT,
    ]);

    const cliAmount = cliOutput.find((line) => line.startsWith("Paid:"))?.match(/Paid:\s+(\d+)/)?.[1];
    const cliTransaction = cliOutput
      .find((line) => line.startsWith("Settlement:"))
      ?.match(/Settlement:\s+([0-9a-f]+)/i)?.[1];
    expect(cliAmount).toBe(AMOUNT);
    expect(cliTransaction).toBe(TRANSACTION);

    const ledger = createSpendLedger(new Map([[ASSET, BigInt(AMOUNT) * 2n]]));
    const payer: Payer = {
      payerAddress: PAY_TO,
      async quote() {
        throw new Error("payAndCall should not quote through this seam");
      },
      async pay(url, maxAmount) {
        expect(url).toBe(RESOURCE);
        expect(maxAmount).toBe(AMOUNT);
        ledger.assertWithinCeiling(ASSET, BigInt(AMOUNT));
        ledger.record(ASSET, BigInt(AMOUNT));
        return {
          url,
          paid: true,
          content: { contentType: "application/json", bytes: 11, text: '{"ok":true}' },
          settlement: {
            transaction: TRANSACTION,
            payer: PAY_TO,
            asset: ASSET,
            amount: AMOUNT,
            network: NETWORK,
          },
          status: 200,
        };
      },
    };
    const config = {
      caip2: NETWORK,
      allowedAssets: [ASSET],
    } as unknown as PayerConfig;
    const result = await payAndCall(
      {
        payer,
        ledger,
        config,
        facilitatorUrl: FACILITATOR,
        fetchImpl: vi.fn(async () =>
          Response.json({
            resources: [
              {
                resource: RESOURCE,
                accepts: [
                  {
                    scheme: "exact",
                    network: NETWORK,
                    amount: AMOUNT,
                    asset: ASSET,
                    extra: { areFeesSponsored: true },
                  },
                ],
              },
            ],
          }),
        ),
      },
      "demo report",
      AMOUNT,
    );

    expect(result.selectedUrl).toBe(RESOURCE);
    expect(result.settlement?.amount).toBe(cliAmount);
    expect(result.settlement?.transaction).toBe(cliTransaction);
    expect(result.settlement?.transaction).toMatch(/^[0-9a-f]{64}$/i);
    expect(ledger.snapshot()).toEqual([
      {
        asset: ASSET,
        spent: AMOUNT,
        ceiling: (BigInt(AMOUNT) * 2n).toString(),
        remaining: AMOUNT,
      },
    ]);
  });
});
