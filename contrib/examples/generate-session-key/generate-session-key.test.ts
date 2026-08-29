import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { generateSessionKeyPair } from "./generate-session-key";

describe("generateSessionKeyPair", () => {
  it("returns a public/secret key pair that round-trips through Keypair.fromSecret", () => {
    const { publicKey, secretKey } = generateSessionKeyPair();

    expect(publicKey.startsWith("G")).toBe(true);
    expect(secretKey.startsWith("S")).toBe(true);
    expect(Keypair.fromSecret(secretKey).publicKey()).toBe(publicKey);
  });

  it("generates a different keypair on each call", () => {
    const first = generateSessionKeyPair();
    const second = generateSessionKeyPair();
    expect(first.secretKey).not.toBe(second.secretKey);
  });
});
