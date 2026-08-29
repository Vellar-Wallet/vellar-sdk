// Tests for the smart-account x402 client's WIRING: that it runs the guards
// before anything is signed, handles passthrough/replay, and derives the
// signature expiration correctly.
//
// The guards' own semantics (selection, amount parsing, header decoding) are
// tested once, purely, in x402-guards.test.ts — not re-derived here.

import { describe, expect, it, vi } from "vitest";
import { createX402Client, expirationOffsetFor, type FetchLike } from "./x402-client";
import {
  ConfirmationRequiredError,
  DisallowedAssetError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
  X402NotConfiguredError,
  type SmartAccountX402Signer,
} from "./x402-types";
import { C_ADDRESS, SIM_SOURCE, requirements, response402 } from "./x402-test-fixtures";

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

// #228: high-value payments require explicit confirmation, gated by
// `confirmationThreshold` + `confirm`, on BOTH the createPayment direct path
// and the fetch (402-retry) path. This file never mocks the RPC simulation
// layer (see the passthrough-only coverage above), so a stub signer's
// simulated transaction never produces a real auth entry to sign —
// `buildSignedPayment` reaches its "No wallet auth entry found to sign" check
// instead of ever calling `signAuthEntry`. That's still the right signal
// here: reaching it proves execution got PAST the confirmation gate (i.e.
// confirmation was granted, or wasn't required); a ConfirmationRequiredError
// instead proves confirmation blocked BEFORE that point was ever reached.
describe("explicit confirmation for high-value payments (#228)", () => {
  describe("createPayment", () => {
    it("does not call confirm when the amount is below the threshold, and proceeds past the confirmation gate", async () => {
      const confirm = vi.fn(async () => true);
      const c = client(vi.fn());
      // amount 1_000_000 (fixture default) is below the 5_000_000 threshold,
      // so it should reach (and be rejected by) the stub signer, not confirm.
      await expect(
        c.createPayment(requirements(), {
          maxAmount: 10_000_000n,
          confirmationThreshold: 5_000_000n,
          confirm,
        }),
      ).rejects.toThrow(/No wallet auth entry found to sign/);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("calls confirm with the pending payment's details when the amount meets the threshold", async () => {
      const confirm = vi.fn(async () => true);
      const c = client(vi.fn());
      // confirm resolves true, so this proceeds past confirmation and is
      // rejected by the stub signer instead — proving confirm ran first.
      await expect(
        c.createPayment(requirements({ amount: "5000000" }), {
          maxAmount: 10_000_000n,
          confirmationThreshold: 5_000_000n,
          confirm,
        }),
      ).rejects.toThrow(/No wallet auth entry found to sign/);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 5_000_000n, asset: expect.any(String) }),
      );
    });

    it("throws ConfirmationRequiredError, never reaching the signer, when confirm resolves false", async () => {
      const confirm = vi.fn(async () => false);
      const c = client(vi.fn());
      await expect(
        c.createPayment(requirements({ amount: "9000000" }), {
          maxAmount: 10_000_000n,
          confirmationThreshold: 5_000_000n,
          confirm,
        }),
      ).rejects.toBeInstanceOf(ConfirmationRequiredError);
    });

    it("throws ConfirmationRequiredError, never reaching the signer, when a threshold is set with no confirm callback", async () => {
      const c = client(vi.fn());
      await expect(
        c.createPayment(requirements({ amount: "9000000" }), {
          maxAmount: 10_000_000n,
          confirmationThreshold: 5_000_000n,
          // confirm intentionally omitted — configuration error, fails closed.
        }),
      ).rejects.toBeInstanceOf(ConfirmationRequiredError);
    });

    it("treats an amount exactly equal to the threshold as requiring confirmation", async () => {
      const confirm = vi.fn(async () => true);
      const c = client(vi.fn());
      await expect(
        c.createPayment(requirements({ amount: "5000000" }), {
          maxAmount: 10_000_000n,
          confirmationThreshold: 5_000_000n,
          confirm,
        }),
      ).rejects.toThrow(/No wallet auth entry found to sign/);
      expect(confirm).toHaveBeenCalledTimes(1);
    });

    it("is a no-op (never calls confirm) when confirmationThreshold is unset, preserving existing behavior", async () => {
      const confirm = vi.fn(async () => true);
      const c = client(vi.fn());
      await expect(
        c.createPayment(requirements({ amount: "999999999" }), {
          maxAmount: 10_000_000_000n,
          confirm,
        }),
      ).rejects.toThrow(/No wallet auth entry found to sign/);
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  describe("fetch (402-retry path)", () => {
    it("blocks on confirm before ever retrying with a payment signature", async () => {
      const confirm = vi.fn(async () => true);
      const fetchImpl = vi.fn(async () => response402([requirements({ amount: "5000000" })]));
      const c = client(fetchImpl);
      // confirm approves, so this proceeds to buildSignedPayment and is
      // rejected by the stub signer — proving confirm ran first, and that
      // the retry request was never sent (fetchImpl called once: the 402).
      await expect(
        c.fetch("https://res.test/paid", {
          maxAmount: 10_000_000n,
          confirmationThreshold: 5_000_000n,
          confirm,
        }),
      ).rejects.toThrow(/No wallet auth entry found to sign/);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("never retries the request when confirmation is declined", async () => {
      const confirm = vi.fn(async () => false);
      const fetchImpl = vi.fn(async () => response402([requirements({ amount: "9000000" })]));
      const c = client(fetchImpl);
      await expect(
        c.fetch("https://res.test/paid", {
          maxAmount: 10_000_000n,
          confirmationThreshold: 5_000_000n,
          confirm,
        }),
      ).rejects.toBeInstanceOf(ConfirmationRequiredError);
      // Only the initial 402-triggering request happened; no payment retry.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
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
