// Tests for the smart-account x402 client's WIRING: that it runs the guards
// before anything is signed, handles passthrough/replay, and derives the
// signature expiration correctly.
//
// The guards' own semantics (selection, amount parsing, header decoding) are
// tested once, purely, in x402-guards.test.ts — not re-derived here.

import { describe, expect, it, vi } from "vitest";
import { createX402Client, expirationOffsetFor, type FetchLike } from "./x402-client";
import {
  DisallowedAssetError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
  X402NotConfiguredError,
  type SmartAccountX402Signer,
} from "./x402-types";
import { C_ADDRESS, PAYTO, SIM_SOURCE, TOKEN, requirements, response402 } from "./x402-test-fixtures";
import { SIGNED_REQUEST_HEADER_NAMES } from "./x402-request-auth";
import {
  BudgetAttributeDeniedError,
  InvalidBudgetAttributeRuleError,
} from "./x402-budget-attributes";

describe("createX402Client — rpcUrl validation", () => {
  function withRpcUrl(rpcUrl: string) {
    return () =>
      createX402Client({
        signer: stubSigner,
        rpcUrl,
        network: "testnet",
        simulationSourceAccount: SIM_SOURCE,
      });
  }

  it("an empty rpcUrl throws X402NotConfiguredError, never rpc.Server's raw TypeError", () => {
    expect(withRpcUrl("")).toThrow(X402NotConfiguredError);
    expect(withRpcUrl("")).not.toThrow(TypeError);
  });

  it("non-URL garbage throws X402NotConfiguredError with the example value", () => {
    expect(withRpcUrl("not a url")).toThrow(X402NotConfiguredError);
    expect(withRpcUrl("not a url")).toThrow(/soroban-testnet\.stellar\.org/);
  });

  it("a valid URL constructs the client", () => {
    expect(withRpcUrl("https://soroban-testnet.stellar.org")).not.toThrow();
  });
});

/** A signer stub that never actually signs (guards should reject before signing). */
const stubSigner: SmartAccountX402Signer = {
  address: C_ADDRESS,
  async signAuthEntry() {
    throw new Error("signer should not have been called");
  },
};

function client(fetchImpl: FetchLike, signer: SmartAccountX402Signer = stubSigner) {
  return createX402Client({
    signer,
    rpcUrl: "https://soroban-testnet.stellar.org",
    network: "testnet",
    simulationSourceAccount: SIM_SOURCE,
    fetchImpl,
  });
}

describe("x402 fetch — passthrough", () => {
  it("returns the response unchanged when no payment is required (2xx)", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const c = client(fetchImpl);
    const out = await c.fetch("https://res.test/paid", { maxAmount: 10n });
    expect(out.paid).toBe(false);
    expect(out.response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("x402 fetch — guards reject before signing", () => {
  it("MaxAmountExceededError when the price exceeds maxAmount", async () => {
    const fetchImpl = vi.fn(async () => response402([requirements({ amount: "5000000" })]));
    const c = client(fetchImpl);
    await expect(c.fetch("https://res.test/paid", { maxAmount: 1000000n })).rejects.toBeInstanceOf(
      MaxAmountExceededError,
    );
    // Only the initial request happened; no payment retry.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("DisallowedAssetError when the asset is not in allowedAssets", async () => {
    const fetchImpl = vi.fn(async () => response402([requirements()]));
    const c = client(fetchImpl);
    await expect(
      c.fetch("https://res.test/paid", { maxAmount: 10_000_000n, allowedAssets: ["COTHER"] }),
    ).rejects.toBeInstanceOf(DisallowedAssetError);
  });

  it("NoUsablePaymentOptionError when no exact/stellar:testnet option is offered", async () => {
    const fetchImpl = vi.fn(async () =>
      response402([requirements({ network: "eip155:1", scheme: "exact" })]),
    );
    const c = client(fetchImpl);
    await expect(
      c.fetch("https://res.test/paid", { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(NoUsablePaymentOptionError);
  });

  it("NoUsablePaymentOptionError when fees are not sponsored", async () => {
    const fetchImpl = vi.fn(async () =>
      response402([requirements({ extra: { areFeesSponsored: false } })]),
    );
    const c = client(fetchImpl);
    await expect(c.fetch("https://res.test/paid", { maxAmount: 10_000_000n })).rejects.toThrow(
      /do not sponsor fees/,
    );
  });
});

describe("createPayment — direct-path guards", () => {
  it("rejects over-maxAmount without touching the network", async () => {
    const c = client(vi.fn());
    await expect(
      c.createPayment(requirements({ amount: "9999999999" }), { maxAmount: 1n }),
    ).rejects.toBeInstanceOf(MaxAmountExceededError);
  });

  it("rejects a disallowed asset without touching the network", async () => {
    const c = client(vi.fn());
    await expect(
      c.createPayment(requirements(), { maxAmount: 10_000_000n, allowedAssets: ["COTHER"] }),
    ).rejects.toBeInstanceOf(DisallowedAssetError);
  });

  it("surfaces a malformed amount as InvalidRequirementsError", async () => {
    const c = client(vi.fn());
    await expect(
      c.createPayment(requirements({ amount: "1.5" }), { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(InvalidRequirementsError);
  });
});

describe("expirationOffsetFor — re-exported from ./x402-payment (#299)", () => {
  // Full derivation-math coverage lives in x402-payment.test.ts, next to the
  // function's new home. This just pins that the re-export from ./x402-client
  // still works, so existing `import { expirationOffsetFor } from "./x402-client"`
  // call sites are unaffected by the split.
  it("is callable via the ./x402-client re-export", () => {
    expect(expirationOffsetFor(120)).toBe(22);
  });
});

describe("requestSigning (#226) — opt-in signed requests to the facilitator", () => {
  it("attaches signed-request headers to the initial probe when configured", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok", { status: 200 }));
    const c = createX402Client({
      signer: stubSigner,
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
      fetchImpl,
      requestSigning: { keyId: "key-1", secret: "shared-secret" },
    });

    await c.fetch("https://facilitator.test/paid", { maxAmount: 10n });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers[SIGNED_REQUEST_HEADER_NAMES.keyId]).toBe("key-1");
    expect(headers[SIGNED_REQUEST_HEADER_NAMES.signature]).toMatch(/^HMAC-SHA256 /);
  });

  it("does not attach signed-request headers when requestSigning is absent", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok", { status: 200 }));
    const c = client(fetchImpl);
    await c.fetch("https://res.test/paid", { maxAmount: 10n });
    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers[SIGNED_REQUEST_HEADER_NAMES.signature]).toBeUndefined();
  });

  it("composes with a caller-supplied fetchImpl rather than replacing it", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(url);
      return new Response("ok", { status: 200 });
    });
    const c = createX402Client({
      signer: stubSigner,
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
      fetchImpl,
      requestSigning: { keyId: "key-1", secret: "shared-secret" },
    });
    await c.fetch("https://facilitator.test/paid", { maxAmount: 10n });
    expect(seen).toEqual(["https://facilitator.test/paid"]);
  });
});

describe("budgetAttributes (#225) — attribute-scoped budget checked before signing", () => {
  it("rejects a malformed rule at construction, before any fetch", () => {
    expect(() =>
      createX402Client({
        signer: stubSigner,
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
        simulationSourceAccount: SIM_SOURCE,
        budgetAttributes: [{ merchant: "not-an-address", maxAmount: 1n }],
      }),
    ).toThrow(InvalidBudgetAttributeRuleError);
  });

  it("never throws BudgetAttributeDeniedError when budgetAttributes is omitted (backward compatible)", async () => {
    const fetchImpl = vi.fn(async () => response402([requirements({ amount: "5000000" })]));
    const c = createX402Client({
      signer: stubSigner,
      rpcUrl: "https://rpc.invalid.example",
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
      fetchImpl,
    });
    // No budgetAttributes configured ⇒ assertBudgetAttributes short-circuits
    // before ever constructing a BudgetAttributeDeniedError. Whatever else
    // this rejects with (network/signing, since this test has no live RPC),
    // it must not be that error.
    await expect(
      c.fetch("https://res.test/paid", { maxAmount: 10_000_000n }),
    ).rejects.not.toBeInstanceOf(BudgetAttributeDeniedError);
  });

  it("throws BudgetAttributeDeniedError for a merchant not covered by any rule, before signing", async () => {
    const fetchImpl = vi.fn(async () => response402([requirements()]));
    const c = createX402Client({
      signer: stubSigner,
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
      fetchImpl,
      budgetAttributes: [{ merchant: TOKEN, maxAmount: 10_000_000n }],
    });
    await expect(
      c.fetch("https://res.test/paid", { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(BudgetAttributeDeniedError);
    // Only the initial probe happened — no payment retry, and the stub signer
    // (which throws if called) was never reached.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws BudgetAttributeDeniedError when the amount exceeds the matching rule's ceiling", async () => {
    const fetchImpl = vi.fn(async () => response402([requirements({ amount: "5000000" })]));
    const c = createX402Client({
      signer: stubSigner,
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
      fetchImpl,
      budgetAttributes: [{ merchant: PAYTO, maxAmount: 1_000_000n }],
    });
    await expect(
      c.fetch("https://res.test/paid", { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(BudgetAttributeDeniedError);
  });

  it("permits a payment matching merchant and within the ceiling to proceed past the budget check", async () => {
    // A malformed (but URL-parseable) RPC host so AssembledTransaction.build's
    // network call fails immediately (DNS/connection error) rather than
    // actually reaching testnet — this test only needs to observe that the
    // budget check itself did not reject, not that a full payment completes.
    const fetchImpl = vi.fn(async () => response402([requirements({ amount: "500000" })]));
    const c = createX402Client({
      signer: stubSigner,
      rpcUrl: "https://rpc.invalid.example",
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
      fetchImpl,
      budgetAttributes: [{ merchant: PAYTO, maxAmount: 1_000_000n }],
    });
    await expect(
      c.fetch("https://res.test/paid", { maxAmount: 10_000_000n }),
    ).rejects.not.toBeInstanceOf(BudgetAttributeDeniedError);
  });

  it("checks category via requirements.extra.category", async () => {
    const fetchImpl = vi.fn(async () =>
      response402([requirements({ amount: "500000", extra: { areFeesSponsored: true, category: "electronics" } })]),
    );
    const c = createX402Client({
      signer: stubSigner,
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
      fetchImpl,
      budgetAttributes: [{ merchant: PAYTO, category: "groceries", maxAmount: 1_000_000n }],
    });
    await expect(
      c.fetch("https://res.test/paid", { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(BudgetAttributeDeniedError);
  });

  it("applies a time window using the injected clock", async () => {
    const fetchImpl = vi.fn(async () => response402([requirements({ amount: "500000" })]));
    const c = createX402Client({
      signer: stubSigner,
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
      fetchImpl,
      now: () => new Date("2026-08-15T23:00:00.000Z"),
      budgetAttributes: [
        { merchant: PAYTO, maxAmount: 1_000_000n, window: { startHourUtc: 9, endHourUtc: 17 } },
      ],
    });
    await expect(
      c.fetch("https://res.test/paid", { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(BudgetAttributeDeniedError);
  });

  it("createPayment's direct path also enforces budgetAttributes", async () => {
    const c = createX402Client({
      signer: stubSigner,
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
      budgetAttributes: [{ merchant: TOKEN, maxAmount: 10_000_000n }],
    });
    await expect(
      c.createPayment(requirements(), { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(BudgetAttributeDeniedError);
  });
});

describe("body replay (bug #3)", () => {
  it("rejects a ReadableStream body (can't be replayed on the paid retry)", async () => {
    const fetchImpl = vi.fn(async () => response402([requirements()]));
    const c = client(fetchImpl);
    const stream = new ReadableStream();
    await expect(
      c.fetch("https://res.test/paid", {
        method: "POST",
        body: stream,
        maxAmount: 10_000_000n,
      }),
    ).rejects.toThrow(/ReadableStream body cannot be replayed/);
    // Rejected before ANY request went out.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
