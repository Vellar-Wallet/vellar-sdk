// Example: a fully HEADLESS agent signer. It generates a fresh ed25519 session
// keypair, wraps it in vellar-sdk's real `createSessionKeySigner`
// (src/x402-signer.ts), and signs a hand-built sample x402 auth entry — no
// browser, no passkey, no external input.
//
// This is the "agent" x402 path: an ed25519 session key the agent holds signs
// each V1 (`sorobanCredentialsAddress`) auth entry directly. The produced
// signature is a smart-wallet signature map `Vec[Map[SignerKey -> Signature]]`
// that a Vellar wallet's `__check_auth` accepts. Its spending authority would
// be bounded on-chain by the spending-limit policy attached to the key.
//
// WARNING: TESTNET ONLY. The keypair is generated fresh on every run and holds
// no funds. Never fund it or reuse it for anything real.
//
// Run with: npx tsx headless-agent-signer.ts

import { Address, Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { createSessionKeySigner } from "../../../src/x402-signer";
import type { SmartAccountX402Signer } from "../../../src/x402-types";
import { TESTNET } from "../../../src/config";

const EXPIRATION_LEDGER = 1_000;

/**
 * Build a minimal V1 (`sorobanCredentialsAddress`) auth entry for `payer`,
 * authorizing a dummy SEP-41 `transfer` — just enough structure for the signer
 * to set the expiration, hash the preimage, and sign. Mirrors the fixture used
 * in `src/x402-signer.test.ts`.
 */
export function makeSampleAuthEntry(
  payer: string,
  tokenContract: string,
  payTo: string,
): xdr.SorobanAuthorizationEntry {
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: new Address(payer).toScAddress(),
      nonce: xdr.Int64.fromString("42"),
      signatureExpirationLedger: 0,
      signature: xdr.ScVal.scvVoid(),
    }),
  );
  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(tokenContract).toScAddress(),
        functionName: "transfer",
        args: [
          nativeToScVal(payer, { type: "address" }),
          nativeToScVal(payTo, { type: "address" }),
          nativeToScVal(1n, { type: "i128" }),
        ],
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
}

/** A fresh, disposable contract (C…) address — StrKey-encoded random bytes. */
function randomContractAddress(): string {
  return StrKey.encodeContract(Keypair.random().rawPublicKey());
}

export interface HeadlessSigningResult {
  /** The freshly generated session key (TESTNET ONLY, disposable). */
  sessionKeypair: Keypair;
  /** The smart-account C-address the key signs for. */
  walletAddress: string;
  /** The signer built from the session key. */
  signer: SmartAccountX402Signer;
  /** The signed auth entry, base64 XDR. */
  signedEntryXdr: string;
}

/**
 * Generate a fresh session key, build the signer, and sign a sample auth entry
 * end-to-end. Returns everything needed to inspect (or verify) the result.
 */
export async function runHeadlessSigning(): Promise<HeadlessSigningResult> {
  // 1. Generate a fresh ed25519 session keypair (no external input).
  const sessionKeypair = Keypair.random();

  // 2. Pick the smart-account wallet the key is authorized to sign for.
  const walletAddress = randomContractAddress();

  // 3. Build the headless signer around the raw secret.
  const signer = createSessionKeySigner({
    address: walletAddress,
    secretKey: sessionKeypair.secret(),
  });

  // 4. Hand-build a sample auth entry for that wallet and sign it.
  const entry = makeSampleAuthEntry(walletAddress, randomContractAddress(), randomContractAddress());
  const signedEntryXdr = await signer.signAuthEntry(entry.toXDR("base64"), {
    networkPassphrase: TESTNET.networkPassphrase,
    expirationLedger: EXPIRATION_LEDGER,
  });

  return { sessionKeypair, walletAddress, signer, signedEntryXdr };
}

async function main(): Promise<void> {
  console.log("Headless agent signer (TESTNET ONLY — disposable key)\n");

  const { sessionKeypair, walletAddress, signedEntryXdr } = await runHeadlessSigning();

  console.log(`1. Generated session key : ${sessionKeypair.publicKey()}`);
  console.log(`2. Smart-account wallet   : ${walletAddress}`);
  console.log(`3. Built + signed a sample V1 auth entry (expiration ledger ${EXPIRATION_LEDGER})`);

  const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedEntryXdr, "base64");
  const creds = signed.credentials().address();
  const sigMap = creds.signature().vec()?.[0]?.map();
  const signerKeyBytes = sigMap?.[0]?.key().vec()?.[1]?.bytes();
  const sigBytes = sigMap?.[0]?.val().vec()?.[1]?.bytes();

  console.log(`4. Credentials kept V1    : ${signed.credentials().switch().name === "sorobanCredentialsAddress"}`);
  console.log(`   Signature expiration   : ${creds.signatureExpirationLedger()}`);
  console.log(`   Signer key matches      : ${Buffer.compare(signerKeyBytes ?? Buffer.alloc(0), sessionKeypair.rawPublicKey()) === 0}`);
  console.log(`   Signature length (bytes): ${sigBytes?.length}`);
  console.log(`5. Signed entry XDR length: ${signedEntryXdr.length} chars`);
  console.log("\nWARNING: the session key above is disposable — do not fund or reuse it.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
