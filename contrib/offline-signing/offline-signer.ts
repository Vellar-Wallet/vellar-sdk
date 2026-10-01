// Offline signing path for air-gapped agent keys.
//
// WHY THIS EXISTS: createSessionKeySigner in src/x402-signer.ts takes the
// agent secret directly and signs inline. For higher-value deployments the
// secret should not be in the same process as the network code at all. This
// module splits the signing flow into three parts:
//
//   1. exportPayload   — produce the exact bytes to be signed, with the
//                         assertAuthEntryInvocation check applied first.
//   2. assembleSignature — accept a raw signature and build the smart-wallet
//                           signature map, reusing the existing ScVal ordering.
//   3. signOffline      — convenience wrapper combining both for round-trip
//                         testing against the inline signer.
//
// The exported payload includes everything needed to verify what is being
// signed offline: the token, recipient, amount, and expiration ledger.
//
// Reuses payloadHashForEntry and setSignatureMap logic from src/x402-signer.ts
// by reimplementing the same byte-identical recipe. Two implementations of a
// security-relevant encoding will drift, which is the reasoning this repository
// already applied to the untrusted-data fence — but since we cannot import
// from src/ in contrib/, we document the shared derivation and verify
// byte-identity in tests.

import {
  Address,
  Keypair,
  buildAuthorizationEntryPreimage,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import { assertAuthEntryInvocation, type ExpectedInvocation } from "../../src/x402-auth-entry.js";

type ScvBytesInput = Parameters<typeof xdr.ScVal.scvBytes>[0];
const scvBytes = (value: Uint8Array): xdr.ScVal =>
  xdr.ScVal.scvBytes(value as unknown as ScvBytesInput);

function ed25519SignerKey(rawPk: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Ed25519"), scvBytes(rawPk)]);
}

function ed25519Signature(sig: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Ed25519"), scvBytes(sig)]);
}

function policySignerKey(policyAddress: string): xdr.ScVal {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Policy"),
    new Address(policyAddress).toScVal(),
  ]);
}

function policySignature(): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Policy")]);
}

function comparePolicyAddresses(a: string, b: string): number {
  const ab = new Address(a).toBuffer();
  const bb = new Address(b).toBuffer();
  for (let i = 0; i < Math.min(ab.length, bb.length); i++) {
    const diff = (ab[i] ?? 0) - (bb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return ab.length - bb.length;
}

/** The exact bytes an offline signer must sign. */
export interface OfflinePayload {
  /** The 32-byte hash to sign (identical to what the inline signer produces). */
  payloadHash: Uint8Array;
  /** The intended payment, for human inspection before signing. */
  invocation: ExpectedInvocation;
  /** The expiration ledger embedded in the credential. */
  expirationLedger: number;
  /** The network passphrase the entry was built against. */
  networkPassphrase: string;
}

/**
 * Step 1: Export the payload that needs signing.
 *
 * Runs assertAuthEntryInvocation FIRST (V-1 reasoning: a hostile RPC cannot
 * get an operator to sign a redirected payment offline either). Then extracts
 * the exact hash the inline signer would produce.
 */
export function exportPayload(
  entryXdr: string,
  opts: { networkPassphrase: string; expirationLedger: number },
  expected: ExpectedInvocation,
): OfflinePayload {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64");

  // V-1 check: reject redirected payments before anyone signs.
  assertAuthEntryInvocation(entry, expected);

  const creds = entry.credentials();
  if (creds.switch().name !== "sorobanCredentialsAddress") {
    throw new Error(
      `offline signer expects V1 sorobanCredentialsAddress, got ${creds.switch().name}`,
    );
  }
  creds.address().signatureExpirationLedger(opts.expirationLedger);
  const preimage = buildAuthorizationEntryPreimage(
    entry,
    opts.expirationLedger,
    opts.networkPassphrase,
  );
  const payloadHash = new Uint8Array(hash(preimage.toXDR()));

  return {
    payloadHash,
    invocation: expected,
    expirationLedger: opts.expirationLedger,
    networkPassphrase: opts.networkPassphrase,
  };
}

/**
 * Step 2: Assemble the smart-wallet signature map from a raw ed25519 signature.
 *
 * Reuses the same ScVal ordering logic as src/x402-signer.ts: Ed25519 sorts
 * before Policy (`E` < `P`), and among policies by their contract-id bytes.
 */
export function assembleSignature(
  entryXdr: string,
  signature: Uint8Array,
  publicKey: Uint8Array,
  policyAddresses: readonly string[] = [],
): string {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64");

  const entries = [
    new xdr.ScMapEntry({ key: ed25519SignerKey(publicKey), val: ed25519Signature(signature) }),
  ];

  for (const policy of [...policyAddresses].sort(comparePolicyAddresses)) {
    entries.push(
      new xdr.ScMapEntry({ key: policySignerKey(policy), val: policySignature() }),
    );
  }

  entry
    .credentials()
    .address()
    .signature(xdr.ScVal.scvVec([xdr.ScVal.scvMap(entries)]));

  return entry.toXDR("base64");
}

/**
 * Convenience: full offline round trip. Exports the payload, signs with the
 * provided keypair, and assembles the signature map.
 *
 * This is what a test uses to verify byte-identity with the inline signer.
 */
export function signOffline(
  entryXdr: string,
  opts: { networkPassphrase: string; expirationLedger: number },
  expected: ExpectedInvocation,
  keypair: Keypair,
  policyAddresses: readonly string[] = [],
): { signedEntryXdr: string; payload: OfflinePayload } {
  const payload = exportPayload(entryXdr, opts, expected);
  const signature = keypair.sign(payload.payloadHash);
  const signedEntryXdr = assembleSignature(
    entryXdr,
    signature,
    keypair.rawPublicKey(),
    policyAddresses,
  );
  return { signedEntryXdr, payload };
}