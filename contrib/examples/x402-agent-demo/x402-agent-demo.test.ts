import { describe, expect, it } from "vitest";
import {
  BudgetTracker,
  createMockSessionKeySigner,
  requestResource,
  runAgentPayments,
  type MockResource,
} from "./x402-agent-demo";

describe("requestResource", () => {
  const resource: MockResource = { name: "sample-api", priceStroops: 1_000n };

  it("returns 402 without a payment header", () => {
    const response = requestResource(resource, { headers: {} });
    expect(response.status).toBe(402);
  });

  it("returns 200 once a payment header is present", () => {
    const response = requestResource(resource, { headers: { "PAYMENT-SIGNATURE": "sig" } });
    expect(response.status).toBe(200);
  });
});

describe("createMockSessionKeySigner", () => {
  it("signs with the configured address and never returns an empty signature", () => {
    const signer = createMockSessionKeySigner("CADDR");
    const signature = signer.sign("payload");
    expect(signature).toContain("CADDR");
    expect(signature.length).toBeGreaterThan(0);
  });
});

describe("runAgentPayments", () => {
  it("pays for a resource within budget and rejects one that would exceed it", () => {
    const signer = createMockSessionKeySigner("CADDR");
    const budget = new BudgetTracker(1_000_000n);
    const resources: MockResource[] = [
      { name: "weather-api", priceStroops: 600_000n },
      { name: "market-data-api", priceStroops: 600_000n },
    ];

    const attempts = runAgentPayments(signer, budget, resources);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ resource: "weather-api", outcome: "paid" });
    expect(attempts[1]).toMatchObject({ resource: "market-data-api", outcome: "rejected" });
    expect(attempts[1]?.detail).toMatch(/would exceed remaining budget/);
  });

  it("leaves the budget unchanged when a payment is rejected", () => {
    const signer = createMockSessionKeySigner("CADDR");
    const budget = new BudgetTracker(1_000_000n);
    const resources: MockResource[] = [
      { name: "weather-api", priceStroops: 600_000n },
      { name: "market-data-api", priceStroops: 600_000n },
    ];

    runAgentPayments(signer, budget, resources);

    expect(budget.remainingBudget).toBe(400_000n);
  });

  it("pays for every resource when the total budget covers them all", () => {
    const signer = createMockSessionKeySigner("CADDR");
    const budget = new BudgetTracker(1_000_000n);
    const resources: MockResource[] = [
      { name: "resource-a", priceStroops: 300_000n },
      { name: "resource-b", priceStroops: 300_000n },
    ];

    const attempts = runAgentPayments(signer, budget, resources);

    expect(attempts.every((a) => a.outcome === "paid")).toBe(true);
    expect(budget.remainingBudget).toBe(400_000n);
  });
});

describe("BudgetTracker", () => {
  it("throws for a negative total budget", () => {
    expect(() => new BudgetTracker(-1n)).toThrow(RangeError);
  });

  it("throws for a negative payment amount", () => {
    expect(() => new BudgetTracker(100n).tryRecordPayment(-1n)).toThrow(RangeError);
  });
});
