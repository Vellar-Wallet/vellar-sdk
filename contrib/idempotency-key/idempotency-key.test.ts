// Tests for the idempotency key wrapper (issue #446).
//
// Covers: retry reusing the key, fresh submission with a new key, and the
// ambiguous failure surfacing distinctly.

import { describe, expect, it, vi } from "vitest";
import {
  AmbiguousSubmissionError,
  DefiniteNetworkError,
  withIdempotencyKey,
} from "./idempotency-key";
import type { WalletBackend } from "../src/passkeykit-connector";

const INPUT = {
  keyId: "test-key-id",
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  network: "testnet" as const,
  signedTx: "AAAA...",
};

function makeBackend(
  submitFn: WalletBackend["submitWalletCreation"],
): WalletBackend {
  return {
    submitWalletCreation: submitFn,
    lookupContractId: async () => undefined,
  };
}

describe("withIdempotencyKey", () => {
  it("generates a fresh key per logical submission", async () => {
    const keys: string[] = [];
    const backend = makeBackend(async () => {
      keys.push("ok");
      return { sessionId: "s1" };
    });

    const wrapped = withIdempotencyKey(backend, {
      generateKey: () => `key-${keys.length}`,
    });

    await wrapped.submitWalletCreation(INPUT);
    await wrapped.submitWalletCreation(INPUT);

    // Two submissions → two distinct keys.
    expect(wrapped.getLastIdempotencyKey()).toBe("key-1");
  });

  it("reuses the same key across retries of the same submission", async () => {
    let attempts = 0;
    const backend = makeBackend(async () => {
      attempts++;
      if (attempts < 3) throw new Error("ECONNRESET: connection reset");
      return { sessionId: "s1" };
    });

    const wrapped = withIdempotencyKey(backend, {
      generateKey: () => "fixed-key",
    });

    await wrapped.submitWalletCreation(INPUT);
    expect(attempts).toBe(3);
    expect(wrapped.getLastIdempotencyKey()).toBe("fixed-key");
  });

  it("retries on ambiguous network errors (timeout, ECONNRESET)", async () => {
    let attempts = 0;
    const backend = makeBackend(async () => {
      attempts++;
      if (attempts <= 2) throw new Error("socket hang up");
      return { sessionId: "s1" };
    });

    const wrapped = withIdempotencyKey(backend);

    const result = await wrapped.submitWalletCreation(INPUT);
    expect(result).toEqual({ sessionId: "s1" });
    expect(attempts).toBe(3);
  });

  it("throws DefiniteNetworkError on DNS failure (safe to retry with fresh key)", async () => {
    const backend = makeBackend(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.example.com");
    });

    const wrapped = withIdempotencyKey(backend);

    await expect(wrapped.submitWalletCreation(INPUT)).rejects.toBeInstanceOf(
      DefiniteNetworkError,
    );
  });

  it("throws DefiniteNetworkError on connection refused", async () => {
    const backend = makeBackend(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3000");
    });

    const wrapped = withIdempotencyKey(backend);

    await expect(wrapped.submitWalletCreation(INPUT)).rejects.toBeInstanceOf(
      DefiniteNetworkError,
    );
  });

  it("throws AmbiguousSubmissionError after 3 ambiguous failures", async () => {
    const backend = makeBackend(async () => {
      throw new Error("socket hang up");
    });

    const wrapped = withIdempotencyKey(backend, {
      generateKey: () => "retry-key",
    });

    try {
      await wrapped.submitWalletCreation(INPUT);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AmbiguousSubmissionError);
      const e = err as AmbiguousSubmissionError;
      expect(e.idempotencyKey).toBe("retry-key");
      expect(e.attempt).toBe(3);
      expect(e.message).toContain("retry-key");
      expect(e.message).toContain("double submission");
    }
  });

  it("succeeds on first attempt without retrying", async () => {
    let attempts = 0;
    const backend = makeBackend(async () => {
      attempts++;
      return { sessionId: "s1" };
    });

    const wrapped = withIdempotencyKey(backend);

    const result = await wrapped.submitWalletCreation(INPUT);
    expect(result).toEqual({ sessionId: "s1" });
    expect(attempts).toBe(1);
  });

  it("forwards lookupContractId unchanged", async () => {
    const lookup = vi.fn(async () => ({
      contractId: "CABC",
      sessionId: "s2",
    }));
    const backend = makeBackend(async () => ({ sessionId: "s1" }));
    backend.lookupContractId = lookup;

    const wrapped = withIdempotencyKey(backend);

    const result = await wrapped.lookupContractId({
      keyId: "k1",
      network: "testnet",
    });
    expect(result).toEqual({ contractId: "CABC", sessionId: "s2" });
    expect(lookup).toHaveBeenCalledOnce();
  });

  it("preserves the original submission input on success", async () => {
    let received: unknown;
    const backend = makeBackend(async (input) => {
      received = input;
      return { sessionId: "s1" };
    });

    const wrapped = withIdempotencyKey(backend);
    await wrapped.submitWalletCreation(INPUT);

    // The original fields are preserved; the metadata is added alongside.
    expect((received as Record<string, unknown>).keyId).toBe(INPUT.keyId);
    expect((received as Record<string, unknown>).contractId).toBe(INPUT.contractId);
    expect((received as Record<string, unknown>).network).toBe(INPUT.network);
  });
});