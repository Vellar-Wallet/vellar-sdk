import { StrKey } from "@stellar/stellar-sdk";

/**
 * Accepts classic (G...) and contract (C...) addresses.
 *
 * Validation is full StrKey validation, not just prefix and length: the
 * base32 payload, version byte and CRC16 checksum must all be intact. A
 * correctly shaped address with a corrupted checksum returns `false` (it never
 * throws), so callers can use this directly on untrusted input.
 *
 * Mirrors `isValidStellarAddress` in src/tx-rpc.ts; to integrate, replace the
 * one-line doc comment there with this one.
 */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address);
}
