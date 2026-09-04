import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { derivePublicKey } from "./derive-public-key";

describe("derivePublicKey", () => {
  it("derives the matching public key for a valid secret", () => {
    const keypair = Keypair.random();
    expect(derivePublicKey(keypair.secret())).toBe(keypair.publicKey());
  });

  it("throws a clear error for a malformed secret key", () => {
    expect(() => derivePublicKey("not-a-secret-key")).toThrow(
      /is not a valid ed25519 secret key/,
    );
  });

  it("throws a clear error for an empty string", () => {
    expect(() => derivePublicKey("")).toThrow(/is not a valid ed25519 secret key/);
  });
});
