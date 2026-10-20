import { describe, expect, it, vi } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  createRpcTxSubmitter,
  isValidStellarAddress,
  RateLimitError,
  TokenBucket,
} from "./tx-rpc";

describe("TokenBucket", () => {
  it("allows burst calls up to bucket size then rejects", () => {
    let now = 0;
    const bucket = new TokenBucket(3, 1 / 1000, () => now);

    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("refills tokens over time", () => {
    let now = 0;
    const bucket = new TokenBucket(2, 2 / 1000, () => now);

    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);

    now = 500;
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });
});

describe("createRpcTxSubmitter", () => {
  it("rejects excess submissions before hitting the network", async () => {
    const sendTransaction = vi.fn();
    const submitter = createRpcTxSubmitter({
      rpcUrl: "https://rpc.test",
      rateLimit: { bucketSize: 0, refillRate: 0 },
      server: { sendTransaction } as never,
    });

    await expect(submitter.submitTransaction("AAAA")).rejects.toBeInstanceOf(RateLimitError);
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});

// Flip the lowest bit of the last base32 character. The final characters of a
// StrKey encode the CRC16 checksum, so the length and prefix stay intact while
// the checksum no longer matches.
function corruptChecksum(address: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const last = address[address.length - 1];
  const flipped = alphabet[alphabet.indexOf(last) ^ 1];
  return address.slice(0, -1) + flipped;
}

describe("isValidStellarAddress", () => {
  const classic = Keypair.random().publicKey();
  const contract = StrKey.encodeContract(Buffer.alloc(32, 7));

  it("accepts well-formed classic and contract addresses", () => {
    expect(isValidStellarAddress(classic)).toBe(true);
    expect(isValidStellarAddress(contract)).toBe(true);
  });

  it("rejects a C-prefixed address with a corrupted checksum without throwing", () => {
    const bad = corruptChecksum(contract);
    expect(bad).toHaveLength(contract.length);
    expect(bad.startsWith("C")).toBe(true);
    expect(bad).not.toBe(contract);
    expect(() => isValidStellarAddress(bad)).not.toThrow();
    expect(isValidStellarAddress(bad)).toBe(false);
  });

  it("rejects a G-prefixed address with a corrupted checksum without throwing", () => {
    const bad = corruptChecksum(classic);
    expect(bad).toHaveLength(classic.length);
    expect(bad.startsWith("G")).toBe(true);
    expect(bad).not.toBe(classic);
    expect(() => isValidStellarAddress(bad)).not.toThrow();
    expect(isValidStellarAddress(bad)).toBe(false);
  });

  it("rejects empty and wrong-length input", () => {
    expect(isValidStellarAddress("")).toBe(false);
    expect(isValidStellarAddress(classic.slice(0, -1))).toBe(false);
  });
});
