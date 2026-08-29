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
import { C_ADDRESS, SIM_SOURCE, requirements, response402 } from "./x402-test-fixtures";
import { SIGNED_REQUEST_HEADER_NAMES } from "./x402-request-auth";

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

describe("expirationOffsetFor — derived from maxTimeoutSeconds (bug #5)", () => {
  it("derives a SHORT expiration for a short server timeout (no fixed +12)", () => {
    // 30s window ≈ 6 ledgers; minus the safety margin (2) = 4. A fixed +12 would
    // exceed the facilitator's ~6-ledger maxLedger and be rejected.
    expect(expirationOffsetFor(30)).toBe(4);
  });

  it("derives a wider expiration for a long timeout", () => {
    // 120s ≈ 24 ledgers − 2 = 22.
    expect(expirationOffsetFor(120)).toBe(22);
  });

  it("floors at the minimum for a tiny timeout", () => {
    expect(expirationOffsetFor(1)).toBe(3); // MIN_EXPIRATION_LEDGERS
  });

  it("respects an explicit ceiling", () => {
    expect(expirationOffsetFor(120, 10)).toBe(10);
  });

  it("defaults to the 120s window when maxTimeoutSeconds is undefined", () => {
    expect(expirationOffsetFor(undefined)).toBe(22);
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
