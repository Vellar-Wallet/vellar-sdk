import { describe, expect, it, vi } from "vitest";
import {
  PaymentNotConfirmedError,
  withConfirmationThreshold,
} from "./confirmation-threshold";
import type { PaymentRequirements, X402Client } from "../../../src/x402-types";

const CAIP2_TESTNET = "stellar:testnet";
const TOKEN = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const PAYTO = "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A";

function requirements(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: CAIP2_TESTNET,
    asset: TOKEN,
    amount: "1000000",
    payTo: PAYTO,
    maxTimeoutSeconds: 120,
    extra: { areFeesSponsored: true },
    ...over,
  };
}

function b64(o: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function response402(accepts: PaymentRequirements[]): Response {
  return new Response("{}", {
    status: 402,
    headers: { "PAYMENT-REQUIRED": b64({ x402Version: 2, error: "Payment required", accepts }) },
  });
}

/** A wrapped X402Client whose createPayment/fetch throw if called — so a
 * test observing that error proves confirmation was never granted. */
const stubClient: X402Client = {
  async fetch() {
    throw new Error("wrapped client should not have been called");
  },
  async createPayment() {
    throw new Error("wrapped client should not have been called");
  },
};

describe("withConfirmationThreshold — createPayment", () => {
  it("signs immediately (never calls confirm) when the amount is below the threshold", async () => {
    const confirm = vi.fn(async () => true);
    const delegate = vi.fn(async () => ({
      header: "signed",
      requirements: requirements(),
      amount: 1_000_000n,
    }));
    const client = withConfirmationThreshold(
      { ...stubClient, createPayment: delegate },
      { confirmationThreshold: 5_000_000n, confirm, ourCaip2: CAIP2_TESTNET },
    );

    const result = await client.createPayment(requirements(), { maxAmount: 10_000_000n });

    expect(result.amount).toBe(1_000_000n);
    expect(confirm).not.toHaveBeenCalled();
    expect(delegate).toHaveBeenCalledTimes(1);
  });

  it("blocks on confirm when the amount meets the threshold, then delegates once approved", async () => {
    const confirm = vi.fn(async () => true);
    const delegate = vi.fn(async () => ({
      header: "signed",
      requirements: requirements({ amount: "5000000" }),
      amount: 5_000_000n,
    }));
    const client = withConfirmationThreshold(
      { ...stubClient, createPayment: delegate },
      { confirmationThreshold: 5_000_000n, confirm, ourCaip2: CAIP2_TESTNET },
    );

    const result = await client.createPayment(requirements({ amount: "5000000" }), {
      maxAmount: 10_000_000n,
    });

    expect(result.amount).toBe(5_000_000n);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5_000_000n, asset: TOKEN }),
    );
  });

  it("throws PaymentNotConfirmedError and never delegates when confirm resolves false", async () => {
    const confirm = vi.fn(async () => false);
    const client = withConfirmationThreshold(stubClient, {
      confirmationThreshold: 5_000_000n,
      confirm,
      ourCaip2: CAIP2_TESTNET,
    });

    await expect(
      client.createPayment(requirements({ amount: "9000000" }), { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(PaymentNotConfirmedError);
  });

  it("treats an amount exactly equal to the threshold as requiring confirmation", async () => {
    const confirm = vi.fn(async () => true);
    const delegate = vi.fn(async () => ({
      header: "signed",
      requirements: requirements({ amount: "5000000" }),
      amount: 5_000_000n,
    }));
    const client = withConfirmationThreshold(
      { ...stubClient, createPayment: delegate },
      { confirmationThreshold: 5_000_000n, confirm, ourCaip2: CAIP2_TESTNET },
    );

    await client.createPayment(requirements({ amount: "5000000" }), { maxAmount: 10_000_000n });
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

describe("withConfirmationThreshold — fetch", () => {
  it("passes through untouched (never calls confirm) when no payment is required", async () => {
    const confirm = vi.fn(async () => true);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    try {
      const delegate = vi.fn(async () => ({
        response: new Response("ok", { status: 200 }),
        paid: false,
      }));
      const client = withConfirmationThreshold(
        { ...stubClient, fetch: delegate },
        { confirmationThreshold: 5_000_000n, confirm, ourCaip2: CAIP2_TESTNET },
      );

      const out = await client.fetch("https://res.test/paid", { maxAmount: 10_000_000n });
      expect(out.paid).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("blocks on confirm before delegating when the decoded 402 amount meets the threshold", async () => {
    const confirm = vi.fn(async () => true);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => response402([requirements({ amount: "5000000" })]));
    try {
      const delegate = vi.fn(async () => ({
        response: new Response("unlocked", { status: 200 }),
        paid: true,
      }));
      const client = withConfirmationThreshold(
        { ...stubClient, fetch: delegate },
        { confirmationThreshold: 5_000_000n, confirm, ourCaip2: CAIP2_TESTNET },
      );

      const out = await client.fetch("https://res.test/paid", { maxAmount: 10_000_000n });
      expect(out.paid).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(delegate).toHaveBeenCalledTimes(1); // the real client still does its own fetch+402+sign
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("never delegates to the wrapped client's fetch when confirmation is declined", async () => {
    const confirm = vi.fn(async () => false);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => response402([requirements({ amount: "9000000" })]));
    try {
      const delegate = vi.fn();
      const client = withConfirmationThreshold(
        { ...stubClient, fetch: delegate },
        { confirmationThreshold: 5_000_000n, confirm, ourCaip2: CAIP2_TESTNET },
      );

      await expect(
        client.fetch("https://res.test/paid", { maxAmount: 10_000_000n }),
      ).rejects.toBeInstanceOf(PaymentNotConfirmedError);
      expect(delegate).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
