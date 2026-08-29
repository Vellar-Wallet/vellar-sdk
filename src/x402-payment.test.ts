// Module-level tests for ./x402-payment — the payment-building/signing layer
// split out of ./x402-client (#299).
//
// `expirationOffsetFor`'s derivation math lived in x402-client.test.ts before
// the split; it moves here with the function. `buildSignedPayment`'s own
// wiring (guard-before-signing, budget checks) stays covered end-to-end via
// x402-client.test.ts, since that's the orchestration this module doesn't own —
// what belongs here is this module's own error paths.

import { rpc } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { expirationOffsetFor, buildSignedPayment } from "./x402-payment";
import { NoUsablePaymentOptionError, type SmartAccountX402Signer } from "./x402-types";
import { C_ADDRESS, SIM_SOURCE, requirements } from "./x402-test-fixtures";

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

const stubSigner: SmartAccountX402Signer = {
  address: C_ADDRESS,
  async signAuthEntry() {
    throw new Error("signer should not have been called");
  },
};

describe("buildSignedPayment — unknown network", () => {
  it("throws NoUsablePaymentOptionError for a network not in NETWORKS, before touching RPC", async () => {
    const server = new rpc.Server("https://rpc.invalid.example");
    await expect(
      buildSignedPayment(requirements({ network: "eip155:1" }), {
        signer: stubSigner,
        rpcUrl: "https://rpc.invalid.example",
        server,
        simulationSourceAccount: SIM_SOURCE,
      }),
    ).rejects.toBeInstanceOf(NoUsablePaymentOptionError);
  });
});
