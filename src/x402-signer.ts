// x402 smart-account signers — produce V1 (`sorobanCredentialsAddress`) auth-entry
// signatures a Vellar wallet's `__check_auth` accepts.
//
// WHY THE SDK OWNS THIS (and doesn't call passkey-kit's signAuthEntry): passkey-kit
// 0.14 unconditionally upgrades V1 → V2 (CAP-0071-02) before hashing (its
// `tx-ops.js`: "there is deliberately NO V1 signing path"). Hosted x402
// facilitators REJECT V2 credentials. So we replicate the auth-payload recipe
// here — set expiration → buildAuthorizationEntryPreimage → hash → sign → build
// the smart-wallet signature map `Vec[Map[SignerKey → Signature]]` — but keep V1
// credentials. Proven in scripts/x402-spike/ (matrix a + budget enforcement).
//
// Two signers, one shared V1 core:
//   - createSessionKeySigner: an ed25519 session key signs the payload hash
//     directly (the agent flow — headless, no passkey).
//   - createPasskeyX402Signer: a WebAuthn (secp256r1) assertion over the payload
//     (the human flow — one passkey prompt per payment). The browser ceremony is
//     supplied via a structural WebAuthnAssertionSigner seam so the SDK never
//     imports passkey-kit; the host wires passkey-kit's low-level signer to it.

import {
  Address,
  Keypair,
  buildAuthorizationEntryPreimage,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import type { SmartAccountX402Signer } from "./x402-types";

// ── raw ScVal builders (byte-identical to the wallet contract spec; verified) ──
//
// Soroban enum-variant encoding: a UDT union variant is scvVec([symbol, ...vals]).
//   SignerKey::Ed25519(pk)      = scvVec([sym "Ed25519", bytes(pk32)])
//   SignerKey::Secp256r1(keyId) = scvVec([sym "Secp256r1", bytes(keyId)])
//   Signature::Ed25519(sig)     = scvVec([sym "Ed25519", bytes(sig64)])
//   Signature::Secp256r1(sig)   = scvVec([sym "Secp256r1", <Secp256r1Signature struct>])

// stellar-sdk's scvBytes accepts a Uint8Array directly, so no Buffer is needed
// (this package targets browsers/bundlers and does not depend on @types/node).
function ed25519SignerKey(rawPk: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Ed25519"), xdr.ScVal.scvBytes(rawPk)]);
}

function ed25519Signature(sig: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Ed25519"), xdr.ScVal.scvBytes(sig)]);
}

function secp256r1SignerKey(keyId: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Secp256r1"), xdr.ScVal.scvBytes(keyId)]);
}

/**
 * `Signature::Secp256r1(Secp256r1Signature { authenticator_data, client_data_json,
 * signature })`. The struct fields are encoded as an scvMap keyed by field name
 * (alphabetical: authenticator_data, client_data_json, signature) — the standard
 * Soroban struct encoding the wallet's spec produces.
 */
function secp256r1Signature(a: WebAuthnAssertion): xdr.ScVal {
  const entry = (name: string, val: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(name), val });
  const structVal = xdr.ScVal.scvMap([
    entry("authenticator_data", xdr.ScVal.scvBytes(a.authenticatorData)),
    entry("client_data_json", xdr.ScVal.scvBytes(a.clientDataJSON)),
    entry("signature", xdr.ScVal.scvBytes(a.signature)),
  ]);
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Secp256r1"), structVal]);
}

// ── shared V1 core ─────────────────────────────────────────────────────────────

/** Set the credential's expiration + compute the payload hash the signer signs. */
function payloadHashForEntry(
  entry: xdr.SorobanAuthorizationEntry,
  networkPassphrase: string,
  expirationLedger: number,
) {
  const creds = entry.credentials();
  if (creds.switch().name !== "sorobanCredentialsAddress") {
    throw new Error(
      `x402 signer expects V1 sorobanCredentialsAddress, got ${creds.switch().name}`,
    );
  }
  creds.address().signatureExpirationLedger(expirationLedger);
  const preimage = buildAuthorizationEntryPreimage(entry, expirationLedger, networkPassphrase);
  return hash(preimage.toXDR());
}

/** Set the entry's signature to the smart-wallet map `Vec[Map[key → sig]]`. */
function setSignatureMap(
  entry: xdr.SorobanAuthorizationEntry,
  scKey: xdr.ScVal,
  scSig: xdr.ScVal,
): void {
  entry
    .credentials()
    .address()
    .signature(xdr.ScVal.scvVec([xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: scKey, val: scSig })])]));
}

// ── agent (ed25519) signer ─────────────────────────────────────────────────────

export interface SessionKeySignerConfig {
  /** The smart-account C-address that pays. */
  address: string;
  /** The ed25519 session key secret (`S…`) attached to that wallet. */
  secretKey: string;
}

/**
 * The agent x402 signer: a raw ed25519 session key signs each auth entry headlessly
 * (no passkey). This is the key an agent holds — its authority is bounded on-chain
 * by the spending-limit policy attached to it via `SignerLimits`.
 */
export function createSessionKeySigner(config: SessionKeySignerConfig): SmartAccountX402Signer {
  const keypair = Keypair.fromSecret(config.secretKey);
  const rawPk = keypair.rawPublicKey();
  if (!isContractAddress(config.address)) {
    throw new Error(`session-key signer address must be a contract (C…): got ${config.address}`);
  }

  return {
    address: config.address,
    async signAuthEntry(entryXdr, { networkPassphrase, expirationLedger }) {
      const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64");
      assertEntryAddress(entry, config.address);
      const payload = payloadHashForEntry(entry, networkPassphrase, expirationLedger);
      const signature = keypair.sign(payload);
      setSignatureMap(entry, ed25519SignerKey(rawPk), ed25519Signature(signature));
      return entry.toXDR("base64");
    },
  };
}

// ── human (passkey / secp256r1) signer ─────────────────────────────────────────

/** A WebAuthn assertion over a 32-byte payload hash. The `signature` is the raw
 * secp256r1 signature; `keyId` is the credential id (the wallet's Secp256r1 signer
 * key). Supplied by the host (wired to passkey-kit's low-level WebAuthn signer) so
 * the SDK never imports passkey-kit or the browser WebAuthn API directly. */
export interface WebAuthnAssertion {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  /** Raw credential id bytes (the on-chain Secp256r1 signer key). */
  keyId: Uint8Array;
}

/** The browser ceremony seam: sign a payload hash, returning the assertion. */
export interface WebAuthnAssertionSigner {
  sign(payloadHash: Uint8Array): Promise<WebAuthnAssertion>;
}

export interface PasskeyX402SignerConfig {
  /** The smart-account C-address that pays. */
  address: string;
  /** The WebAuthn ceremony (host-wired; runs the passkey prompt). */
  webAuthn: WebAuthnAssertionSigner;
}

/**
 * The human x402 signer: each payment prompts the passkey once. Reuses the host's
 * audited WebAuthn ceremony (via `webAuthn`) for the secp256r1 assertion, and this
 * SDK owns the V1 auth-entry assembly (NOT passkey-kit's V2-forcing path).
 *
 * This preserves §8 "no silent signing": a person explicitly approves each x402
 * payment with their passkey — there is no headless spend on the passkey path.
 */
export function createPasskeyX402Signer(config: PasskeyX402SignerConfig): SmartAccountX402Signer {
  if (!isContractAddress(config.address)) {
    throw new Error(`passkey signer address must be a contract (C…): got ${config.address}`);
  }
  return {
    address: config.address,
    async signAuthEntry(entryXdr, { networkPassphrase, expirationLedger }) {
      const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64");
      assertEntryAddress(entry, config.address);
      const payload = payloadHashForEntry(entry, networkPassphrase, expirationLedger);
      const assertion = await config.webAuthn.sign(new Uint8Array(payload));
      setSignatureMap(
        entry,
        secp256r1SignerKey(assertion.keyId),
        secp256r1Signature(assertion),
      );
      return entry.toXDR("base64");
    },
  };
}

// ── helpers ────────────────────────────────────────────────────────────────────

function isContractAddress(address: string): boolean {
  return typeof address === "string" && address.startsWith("C") && address.length === 56;
}

/**
 * Guard: the entry must be a V1 (`sorobanCredentialsAddress`) credential for
 * THIS signer's wallet. The V1 check comes FIRST — reading `.address()` on a V2
 * credential throws an opaque "address not set", so we reject V2 with a clear
 * message before touching the address.
 */
function assertEntryAddress(entry: xdr.SorobanAuthorizationEntry, expected: string): void {
  const creds = entry.credentials();
  if (creds.switch().name !== "sorobanCredentialsAddress") {
    throw new Error(
      `x402 signer expects V1 sorobanCredentialsAddress, got ${creds.switch().name}`,
    );
  }
  const entryAddr = Address.fromScAddress(creds.address().address()).toString();
  if (entryAddr !== expected) {
    throw new Error(
      `auth entry credential address ${entryAddr} does not match signer address ${expected}`,
    );
  }
}
