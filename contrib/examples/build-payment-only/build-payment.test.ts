import { describe, expect, it } from "vitest";
import { createPaymentClient } from "../../../src/payments-client";
import type { TokenInfo } from "../../../src/balances";
import { createMockSacClient } from "./build-payment";

describe("build-payment-only (mock SAC client)", () => {
  it("builds and simulates a payment without ever submitting it", async () => {
    const { sac, getLastBuilt } = createMockSacClient();
    const paymentClient = createPaymentClient({
      kit: { sign: async (tx: unknown) => tx },
      sac,
      backend: {
        async submitTransaction() {
          throw new Error("submitTransaction must never be called by this example");
        },
      },
      network: "testnet",
      isValidAddress: () => true,
    });

    const token: TokenInfo = { symbol: "TOKEN", contractId: "CTOKEN", decimals: 7 };
    const prepared = await paymentClient.preparePayment({
      from: "CFROM",
      to: "GTO",
      token,
      amount: 105_000_000n,
    });

    expect(prepared.review).toEqual({
      from: "CFROM",
      to: "GTO",
      token,
      amount: 105_000_000n,
      network: "testnet",
    });
    expect(getLastBuilt()?.toXDR()).toContain("CTOKEN");
    expect(getLastBuilt()?.toXDR()).toContain("105000000");
    // Deliberately never call prepared.confirm() — that's the whole point of
    // this example, and the mock backend throws if it's ever reached.
  });
});
