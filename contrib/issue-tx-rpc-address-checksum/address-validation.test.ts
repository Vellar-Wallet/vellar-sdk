import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { isValidStellarAddress as srcIsValidStellarAddress } from "../../src/tx-rpc";
import { isValidStellarAddress } from "./address-validation";

// Flip the lowest bit of the last base32 character. The final characters of a
// StrKey encode the CRC16 checksum, so the length and prefix stay intact while
// the checksum no longer matches.
function corruptChecksum(address: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const last = address[address.length - 1];
  return address.slice(0, -1) + alphabet[alphabet.indexOf(last) ^ 1];
}

describe.each([
  ["contrib reference", isValidStellarAddress],
  ["src/tx-rpc", srcIsValidStellarAddress],
])("isValidStellarAddress (%s)", (_name, isValid) => {
  const classic = Keypair.random().publicKey();
  const contract = StrKey.encodeContract(Buffer.alloc(32, 7));

  it("accepts well-formed classic and contract addresses", () => {
    expect(isValid(classic)).toBe(true);
    expect(isValid(contract)).toBe(true);
  });

  it("rejects a C-prefixed address with a corrupted checksum without throwing", () => {
    const bad = corruptChecksum(contract);
    expect(bad).toHaveLength(contract.length);
    expect(bad.startsWith("C")).toBe(true);
    expect(bad).not.toBe(contract);
    expect(() => isValid(bad)).not.toThrow();
    expect(isValid(bad)).toBe(false);
  });

  it("rejects a G-prefixed address with a corrupted checksum without throwing", () => {
    const bad = corruptChecksum(classic);
    expect(bad).toHaveLength(classic.length);
    expect(bad.startsWith("G")).toBe(true);
    expect(bad).not.toBe(classic);
    expect(() => isValid(bad)).not.toThrow();
    expect(isValid(bad)).toBe(false);
  });

  it("rejects empty and wrong-length input", () => {
    expect(isValid("")).toBe(false);
    expect(isValid(classic.slice(0, -1))).toBe(false);
  });
});
