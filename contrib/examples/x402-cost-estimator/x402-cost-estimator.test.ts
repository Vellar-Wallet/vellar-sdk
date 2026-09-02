import { describe, expect, it } from "vitest";
import { estimateCost, MOCK_RATE_TABLE, type PlannedPayment } from "./x402-cost-estimator";

describe("estimateCost", () => {
  it("converts each payment to the reference currency and sums the total", () => {
    const payments: PlannedPayment[] = [
      { asset: "USDC", amount: "5" },
      { asset: "USDC", amount: "2.5" },
      { asset: "XLM", amount: "100" },
      { asset: "EURC", amount: "10" },
    ];

    const estimate = estimateCost(payments);

    expect(estimate.items).toEqual([
      { asset: "USDC", amount: "5", referenceCost: "5" },
      { asset: "USDC", amount: "2.5", referenceCost: "2.5" },
      { asset: "XLM", amount: "100", referenceCost: "12" },
      { asset: "EURC", amount: "10", referenceCost: "10.8" },
    ]);
    expect(estimate.totalReferenceCost).toBe("30.3");
    expect(estimate.referenceCurrency).toBe("USD");
  });

  it("throws a clear error for an asset missing from the rate table", () => {
    expect(() => estimateCost([{ asset: "DOGE", amount: "1" }])).toThrow(
      /No rate available for asset "DOGE"/,
    );
  });

  it("returns a zero total for an empty payment list", () => {
    const estimate = estimateCost([]);
    expect(estimate.items).toEqual([]);
    expect(estimate.totalReferenceCost).toBe("0");
  });

  it("accepts a custom rate table instead of the default mock one", () => {
    const estimate = estimateCost([{ asset: "GOLD", amount: "2" }], { GOLD: "2000" });
    expect(estimate.totalReferenceCost).toBe("4000");
  });

  it("does not mutate the default MOCK_RATE_TABLE export", () => {
    const before = { ...MOCK_RATE_TABLE };
    estimateCost([{ asset: "USDC", amount: "1" }]);
    expect(MOCK_RATE_TABLE).toEqual(before);
  });
});
