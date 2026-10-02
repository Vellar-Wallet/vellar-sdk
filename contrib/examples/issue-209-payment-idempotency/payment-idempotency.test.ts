import { describe, expect, it, vi } from "vitest";
import {
  assertValidIdempotencyKey,
  DEFAULT_IDEMPOTENCY_CACHE_SIZE,
  derivePaymentIdempotencyKey,
  fingerprintPayload,
  IdempotencyKeyConflictError,
  InvalidIdempotencyKeyError,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  withIdempotency,
  type PaymentSubmitBackendLike,
} from "./payment-idempotency";

const payload = { signedXdr: "AAAA-signed-xdr", network: "testnet" } as const;
const otherPayload = { signedXdr: "BBBB-different-xdr", network: "testnet" } as const;

function backendReturning(hash = "hash-1"): PaymentSubmitBackendLike & {
  submitTransaction: ReturnType<typeof vi.fn>;
} {
  return { submitTransaction: vi.fn().mockResolvedValue({ hash }) };
}

/** A backend whose submissions resolve only when the test says so. */
function deferredBackend() {
  const resolvers: ((result: { hash: string }) => void)[] = [];
  const rejecters: ((err: unknown) => void)[] = [];
  const submitTransaction = vi.fn().mockImplementation(
    () =>
      new Promise<{ hash: string }>((resolve, reject) => {
        resolvers.push(resolve);
        rejecters.push(reject);
      }),
  );
  return { submitTransaction, resolvers, rejecters };
}

describe("duplicate key with the same payload", () => {
  it("submits once and returns the cached result", async () => {
    const backend = backendReturning("hash-1");
    const client = withIdempotency(backend);

    const first = await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });
    const second = await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });

    expect(first).toEqual({ hash: "hash-1" });
    expect(second).toEqual({ hash: "hash-1" });
    expect(backend.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("stays deduplicated across many retries", async () => {
    const backend = backendReturning();
    const client = withIdempotency(backend);

    for (let i = 0; i < 5; i++) {
      await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });
    }
    expect(backend.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not pass idempotencyKey through to the backend", async () => {
    const backend = backendReturning();
    await withIdempotency(backend).submitTransaction({ ...payload, idempotencyKey: "key-1" });
    expect(backend.submitTransaction).toHaveBeenCalledWith(payload);
  });

  it("deduplicates concurrent retries — the timeout-retry case", async () => {
    const backend = deferredBackend();
    const client = withIdempotency(backend);

    // Both calls start before either resolves. Caching only the settled result
    // would let both through and double-submit.
    const a = client.submitTransaction({ ...payload, idempotencyKey: "key-1" });
    const b = client.submitTransaction({ ...payload, idempotencyKey: "key-1" });

    expect(backend.submitTransaction).toHaveBeenCalledTimes(1);
    backend.resolvers[0]!({ hash: "hash-1" });

    await expect(a).resolves.toEqual({ hash: "hash-1" });
    await expect(b).resolves.toEqual({ hash: "hash-1" });
    expect(backend.submitTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("duplicate key with a differing payload", () => {
  it("throws instead of returning the first payment's hash", async () => {
    const client = withIdempotency(backendReturning("hash-1"));
    await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });

    await expect(
      client.submitTransaction({ ...otherPayload, idempotencyKey: "key-1" }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
  });

  it("does not submit the conflicting payload", async () => {
    const backend = backendReturning();
    const client = withIdempotency(backend);
    await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });

    await expect(
      client.submitTransaction({ ...otherPayload, idempotencyKey: "key-1" }),
    ).rejects.toThrow(IdempotencyKeyConflictError);
    expect(backend.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("treats a changed network as a differing payload", async () => {
    const client = withIdempotency(backendReturning());
    await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });

    await expect(
      client.submitTransaction({
        signedXdr: payload.signedXdr,
        network: "mainnet",
        idempotencyKey: "key-1",
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
  });

  it("reports both fingerprints on the conflict", async () => {
    const client = withIdempotency(backendReturning());
    await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });

    try {
      await client.submitTransaction({ ...otherPayload, idempotencyKey: "key-1" });
      expect.unreachable("expected a conflict");
    } catch (err) {
      const conflict = err as IdempotencyKeyConflictError;
      expect(conflict.idempotencyKey).toBe("key-1");
      expect(conflict.cachedFingerprint).toBe(fingerprintPayload(payload));
      expect(conflict.requestFingerprint).toBe(fingerprintPayload(otherPayload));
      expect(conflict.cachedFingerprint).not.toBe(conflict.requestFingerprint);
    }
  });

  it("conflicts against an in-flight submission too", async () => {
    const backend = deferredBackend();
    const client = withIdempotency(backend);

    const inflight = client.submitTransaction({ ...payload, idempotencyKey: "key-1" });
    await expect(
      client.submitTransaction({ ...otherPayload, idempotencyKey: "key-1" }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);

    backend.resolvers[0]!({ hash: "hash-1" });
    await expect(inflight).resolves.toEqual({ hash: "hash-1" });
  });
});

describe("distinct keys", () => {
  it("submits each key separately", async () => {
    const backend: PaymentSubmitBackendLike = {
      submitTransaction: vi
        .fn()
        .mockResolvedValueOnce({ hash: "hash-1" })
        .mockResolvedValueOnce({ hash: "hash-2" }),
    };
    const client = withIdempotency(backend);

    await expect(
      client.submitTransaction({ ...payload, idempotencyKey: "key-1" }),
    ).resolves.toEqual({ hash: "hash-1" });
    await expect(
      client.submitTransaction({ ...payload, idempotencyKey: "key-2" }),
    ).resolves.toEqual({ hash: "hash-2" });
    expect(backend.submitTransaction).toHaveBeenCalledTimes(2);
  });

  it("passes through unchanged when no key is supplied", async () => {
    const backend = backendReturning();
    const client = withIdempotency(backend);

    await client.submitTransaction(payload);
    await client.submitTransaction(payload);

    expect(backend.submitTransaction).toHaveBeenCalledTimes(2);
    expect(client.stats().size).toBe(0);
  });
});

describe("failed submissions", () => {
  it("does not cache a rejection — the same key stays retryable", async () => {
    const backend: PaymentSubmitBackendLike = {
      submitTransaction: vi
        .fn()
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce({ hash: "hash-1" }),
    };
    const client = withIdempotency(backend);

    await expect(
      client.submitTransaction({ ...payload, idempotencyKey: "key-1" }),
    ).rejects.toThrow("network down");
    await expect(
      client.submitTransaction({ ...payload, idempotencyKey: "key-1" }),
    ).resolves.toEqual({ hash: "hash-1" });
    expect(backend.submitTransaction).toHaveBeenCalledTimes(2);
  });

  it("evicts the failed key from the cache", async () => {
    const backend: PaymentSubmitBackendLike = {
      submitTransaction: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const client = withIdempotency(backend);

    await expect(
      client.submitTransaction({ ...payload, idempotencyKey: "key-1" }),
    ).rejects.toThrow("boom");
    expect(client.stats().size).toBe(0);
  });

  it("propagates the same rejection to concurrent callers", async () => {
    const backend = deferredBackend();
    const client = withIdempotency(backend);

    const a = client.submitTransaction({ ...payload, idempotencyKey: "key-1" });
    const b = client.submitTransaction({ ...payload, idempotencyKey: "key-1" });
    backend.rejecters[0]!(new Error("relayer rejected"));

    await expect(a).rejects.toThrow("relayer rejected");
    await expect(b).rejects.toThrow("relayer rejected");
    expect(backend.submitTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("key validation", () => {
  it("rejects an empty key", async () => {
    const client = withIdempotency(backendReturning());
    await expect(
      client.submitTransaction({ ...payload, idempotencyKey: "" }),
    ).rejects.toBeInstanceOf(InvalidIdempotencyKeyError);
  });

  it("rejects an over-long key", () => {
    expect(() => assertValidIdempotencyKey("x".repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1))).toThrow(
      InvalidIdempotencyKeyError,
    );
  });

  it("accepts a key at exactly the max length", () => {
    expect(() => assertValidIdempotencyKey("x".repeat(MAX_IDEMPOTENCY_KEY_LENGTH))).not.toThrow();
  });

  it("does not submit when the key is invalid", async () => {
    const backend = backendReturning();
    await expect(
      withIdempotency(backend).submitTransaction({ ...payload, idempotencyKey: "" }),
    ).rejects.toThrow(InvalidIdempotencyKeyError);
    expect(backend.submitTransaction).not.toHaveBeenCalled();
  });
});

describe("cache bounds", () => {
  it("defaults to DEFAULT_IDEMPOTENCY_CACHE_SIZE", async () => {
    const client = withIdempotency(backendReturning());
    for (let i = 0; i < DEFAULT_IDEMPOTENCY_CACHE_SIZE + 10; i++) {
      await client.submitTransaction({ ...payload, idempotencyKey: `key-${i}` });
    }
    expect(client.stats().size).toBe(DEFAULT_IDEMPOTENCY_CACHE_SIZE);
  });

  it("evicts the oldest key first", async () => {
    const client = withIdempotency(backendReturning(), { maxEntries: 2 });
    await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });
    await client.submitTransaction({ ...payload, idempotencyKey: "key-2" });
    await client.submitTransaction({ ...payload, idempotencyKey: "key-3" });

    expect(client.stats().keys).toEqual(["key-2", "key-3"]);
  });

  it("still serves the entry it just created when maxEntries is 1", async () => {
    const backend = backendReturning();
    const client = withIdempotency(backend, { maxEntries: 1 });

    await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });
    await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });

    expect(backend.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("re-submits a key that was evicted", async () => {
    const backend = backendReturning();
    const client = withIdempotency(backend, { maxEntries: 1 });

    await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });
    await client.submitTransaction({ ...payload, idempotencyKey: "key-2" });
    await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });

    expect(backend.submitTransaction).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid maxEntries", () => {
    expect(() => withIdempotency(backendReturning(), { maxEntries: 0 })).toThrow(RangeError);
    expect(() => withIdempotency(backendReturning(), { maxEntries: -1 })).toThrow(RangeError);
    expect(() => withIdempotency(backendReturning(), { maxEntries: 1.5 })).toThrow(RangeError);
  });
});

describe("clear", () => {
  it("drops cached keys so the next call re-submits", async () => {
    const backend = backendReturning();
    const client = withIdempotency(backend);

    await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });
    client.clear();
    await client.submitTransaction({ ...payload, idempotencyKey: "key-1" });

    expect(backend.submitTransaction).toHaveBeenCalledTimes(2);
    expect(client.stats().size).toBe(1);
  });

  it("does not disturb an in-flight submission", async () => {
    const backend = deferredBackend();
    const client = withIdempotency(backend);

    const inflight = client.submitTransaction({ ...payload, idempotencyKey: "key-1" });
    client.clear();
    backend.resolvers[0]!({ hash: "hash-1" });

    await expect(inflight).resolves.toEqual({ hash: "hash-1" });
  });
});

describe("fingerprintPayload", () => {
  it("is stable for the same payload", () => {
    expect(fingerprintPayload(payload)).toBe(fingerprintPayload({ ...payload }));
  });

  it("differs when the xdr differs", () => {
    expect(fingerprintPayload(payload)).not.toBe(fingerprintPayload(otherPayload));
  });

  it("differs when only the network differs", () => {
    expect(fingerprintPayload({ signedXdr: "A", network: "testnet" })).not.toBe(
      fingerprintPayload({ signedXdr: "A", network: "mainnet" }),
    );
  });

  it("is not fooled by a shifted field boundary", () => {
    // Unframed concatenation would hash these identically.
    expect(fingerprintPayload({ signedXdr: "AB", network: "testnet" })).not.toBe(
      fingerprintPayload({ signedXdr: "ABtestnet", network: "testnet" }),
    );
  });
});

describe("derivePaymentIdempotencyKey", () => {
  const base = {
    from: "CFROM",
    to: "CTO",
    asset: "CUSDC",
    amount: 1_000n,
    network: "testnet",
  } as const;

  it("derives the same key for the same payment", () => {
    expect(derivePaymentIdempotencyKey(base)).toBe(derivePaymentIdempotencyKey({ ...base }));
  });

  it("treats a bigint and its string form as the same payment", () => {
    expect(derivePaymentIdempotencyKey(base)).toBe(
      derivePaymentIdempotencyKey({ ...base, amount: "1000" }),
    );
  });

  it.each([
    ["recipient", { to: "COTHER" }],
    ["amount", { amount: 2_000n }],
    ["asset", { asset: "CXLM" }],
    ["sender", { from: "COTHER" }],
    ["network", { network: "mainnet" as const }],
  ])("derives a different key when the %s differs", (_label, override) => {
    expect(derivePaymentIdempotencyKey({ ...base, ...override })).not.toBe(
      derivePaymentIdempotencyKey(base),
    );
  });

  it("separates two intentionally identical payments via nonce", () => {
    expect(derivePaymentIdempotencyKey({ ...base, nonce: "a" })).not.toBe(
      derivePaymentIdempotencyKey({ ...base, nonce: "b" }),
    );
  });

  it("produces a key the wrapper accepts", () => {
    expect(() => assertValidIdempotencyKey(derivePaymentIdempotencyKey(base))).not.toThrow();
  });

  it("deduplicates a retry when used as the key", async () => {
    const backend = backendReturning();
    const client = withIdempotency(backend);
    const key = derivePaymentIdempotencyKey(base);

    await client.submitTransaction({ ...payload, idempotencyKey: key });
    await client.submitTransaction({ ...payload, idempotencyKey: key });

    expect(backend.submitTransaction).toHaveBeenCalledTimes(1);
  });
});
