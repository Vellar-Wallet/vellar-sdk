import { describe, expect, it } from "vitest";
import { MaxAmountExceededError, PaymentRejectedError } from "../../../src/x402-types";
import {
  createMockFacilitator,
  createMockResourceServer,
  createMockX402Client,
  fetchWithPaymentFallback,
} from "./x402-fetch-fallback";

const silent = { log: () => {} };

function wire(remainingBudget: bigint) {
  const server = createMockResourceServer();
  const facilitator = createMockFacilitator({ remainingBudget });
  const client = createMockX402Client({ server, facilitator, payer: "CPAYER" });
  return { server, facilitator, client };
}

describe("mock x402 client", () => {
  it("pays the most premium affordable tier and settles within budget", async () => {
    const { client, facilitator } = wire(1000n);
    const res = await client.fetch("/reports/quarterly", { maxAmount: 1000n });

    expect(res.paid).toBe(true);
    expect(res.response.status).toBe(200);
    expect(res.settlement?.amount).toBe(800n); // premium tier
    expect(facilitator.remaining()).toBe(200n);
  });

  it("throws PaymentRejectedError when the chosen tier exceeds the on-chain budget", async () => {
    const { client } = wire(500n); // premium 800 > budget 500
    await expect(client.fetch("/reports/quarterly", { maxAmount: 1000n })).rejects.toBeInstanceOf(
      PaymentRejectedError,
    );
  });

  it("refuses to sign when nothing fits maxAmount (MaxAmountExceededError, no settle)", async () => {
    const { client, facilitator } = wire(1000n);
    await expect(client.fetch("/reports/quarterly", { maxAmount: 100n })).rejects.toBeInstanceOf(
      MaxAmountExceededError,
    );
    expect(facilitator.attempts()).toBe(0);
  });
});

describe("fetchWithPaymentFallback", () => {
  it("catches PaymentRejectedError and retries once at the lower maxAmount, then succeeds", async () => {
    const { client, server, facilitator } = wire(500n);

    const res = await fetchWithPaymentFallback(
      client,
      "/reports/quarterly",
      { maxAmount: 1000n, fallbackMaxAmount: 450n },
      silent,
    );

    expect(res.paid).toBe(true);
    expect(res.settlement?.amount).toBe(400n); // basic tier, within budget
    expect(server.quotes()).toBe(2); // one initial attempt + one fallback
    expect(facilitator.attempts()).toBe(2); // rejected once, settled once
    expect(facilitator.remaining()).toBe(100n); // 500 - 400
  });

  it("retries at most ONCE — a second rejection propagates", async () => {
    const { client, server, facilitator } = wire(300n); // even basic 400 > budget

    await expect(
      fetchWithPaymentFallback(
        client,
        "/reports/quarterly",
        { maxAmount: 1000n, fallbackMaxAmount: 450n },
        silent,
      ),
    ).rejects.toBeInstanceOf(PaymentRejectedError);

    expect(server.quotes()).toBe(2); // not more than two attempts
    expect(facilitator.attempts()).toBe(2);
  });

  it("does not retry when the first attempt succeeds", async () => {
    const { client, server } = wire(1000n);
    const res = await fetchWithPaymentFallback(
      client,
      "/reports/quarterly",
      { maxAmount: 1000n, fallbackMaxAmount: 450n },
      silent,
    );

    expect(res.settlement?.amount).toBe(800n); // premium, no fallback needed
    expect(server.quotes()).toBe(1);
  });

  it("does not retry on a non-PaymentRejectedError (e.g. MaxAmountExceededError)", async () => {
    const { client, server } = wire(1000n);
    await expect(
      fetchWithPaymentFallback(
        client,
        "/reports/quarterly",
        { maxAmount: 100n, fallbackMaxAmount: 50n },
        silent,
      ),
    ).rejects.toBeInstanceOf(MaxAmountExceededError);
    expect(server.quotes()).toBe(1); // failed before any retry
  });
});
