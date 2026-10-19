// Issue #661 — x402-facade when the seller advertises zero payment schemes.
//
// Drives the REAL createX402Facade → createX402Client. RPC is answered from the
// captured testnet recording so the happy path genuinely signs; every failure
// case asserts that NOTHING was built, simulated or signed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../src/x402-client.js";
import { createX402Facade } from "../../src/x402-facade.js";
import { NoUsablePaymentOptionError } from "../../src/x402-types.js";
import {
  NoPayableSchemeOfferedError,
  assertSchemesOffered,
  createAcceptsGuardedFetch,
} from "./x402-accepts-guard.js";
import {
  RPC_URL,
  SIM_SOURCE,
  challenge,
  mockSorobanRpcFromRecording,
  recordedRequirements,
  recordingSigner,
} from "./test-helpers.js";

let simulateTransaction: ReturnType<typeof mockSorobanRpcFromRecording>["simulateTransaction"];

beforeEach(() => {
  ({ simulateTransaction } = mockSorobanRpcFromRecording());
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A seller that always answers the probe with the given challenge body. */
function seller(body: unknown) {
  const fetchImpl = vi.fn<FetchLike>(async (_url, init) =>
    new Headers(init?.headers).get("PAYMENT-SIGNATURE")
      ? new Response("unlocked", { status: 200 })
      : challenge(body),
  );
  return fetchImpl;
}

function facade(fetchImpl: FetchLike) {
  const { signer, calls } = recordingSigner();
  const x402 = createX402Facade({
    config: { rpcUrl: RPC_URL, network: "testnet", simulationSourceAccount: SIM_SOURCE, fetchImpl },
    resolveSigner: () => signer,
  });
  return { x402, signCalls: calls };
}

describe("x402-facade, unchanged src: empty accepts fails before signing", () => {
  it.each([
    ["empty", { x402Version: 2, accepts: [] }],
    ["missing", { x402Version: 2 }],
  ])("accepts %s → NoUsablePaymentOptionError naming '(none)', no signing", async (_label, body) => {
    const fetchImpl = seller(body);
    const { x402, signCalls } = facade(fetchImpl);

    const err = await x402.fetch("https://res.test/paid", { maxAmount: 10_000_000n }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(NoUsablePaymentOptionError);
    expect((err as Error).message).toMatch(/Server offered: \(none\)/);
    expect(signCalls).toHaveLength(0);
    expect(simulateTransaction).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no paid retry
  });
});

describe("x402-facade with the accepts guard", () => {
  it.each([
    ["empty", { x402Version: 2, accepts: [] }, "empty"],
    ["missing", { x402Version: 2 }, "missing"],
    ["null", { x402Version: 2, accepts: null }, "missing"],
    ["an object", { x402Version: 2, accepts: { scheme: "exact" } }, "a object, not an array"],
    ["a string", { x402Version: 2, accepts: "exact" }, "a string, not an array"],
  ])("accepts %s → NoPayableSchemeOfferedError, nothing signed", async (_label, body, received) => {
    const fetchImpl = seller(body);
    const { x402, signCalls } = facade(createAcceptsGuardedFetch(fetchImpl));

    const err = await x402.fetch("https://res.test/paid", { maxAmount: 10_000_000n }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(NoPayableSchemeOfferedError);
    // Still catchable as the existing type.
    expect(err).toBeInstanceOf(NoUsablePaymentOptionError);
    expect((err as NoPayableSchemeOfferedError).received).toBe(received);
    expect((err as Error).message).toMatch(/offered no payment schemes/);
    expect(signCalls).toHaveLength(0);
    expect(simulateTransaction).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("happy path: a challenge with a payable scheme is signed and paid", async () => {
    const fetchImpl = seller({ x402Version: 2, accepts: [recordedRequirements()] });
    const { x402, signCalls } = facade(createAcceptsGuardedFetch(fetchImpl));

    const out = await x402.fetch("https://res.test/paid", { maxAmount: 10_000_000n });

    expect(out.paid).toBe(true);
    expect(signCalls.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("passes non-402 responses and undecodable 402s through for the client to handle", async () => {
    const ok = await createAcceptsGuardedFetch(async () => new Response("free"))("https://res.test");
    expect(ok.status).toBe(200);

    const bare402 = await createAcceptsGuardedFetch(async () => new Response("{}", { status: 402 }))(
      "https://res.test",
    );
    expect(bare402.status).toBe(402);
  });
});

describe("assertSchemesOffered", () => {
  it("accepts a non-empty array and rejects everything else", () => {
    expect(() => assertSchemesOffered({ accepts: [recordedRequirements()] })).not.toThrow();
    for (const bad of [null, undefined, "x", {}, { accepts: [] }, { accepts: 7 }]) {
      expect(() => assertSchemesOffered(bad)).toThrow(NoPayableSchemeOfferedError);
    }
  });
});
