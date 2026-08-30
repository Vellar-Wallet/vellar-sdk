import { describe, expect, it } from "vitest";
import { buildAuthorizationEntryPreimage, hash, xdr } from "@stellar/stellar-sdk";
import { TESTNET } from "../../../src/config";
import { runHeadlessSigning } from "./headless-agent-signer";

describe("runHeadlessSigning", () => {
  it("signs a sample auth entry with a freshly generated session key", async () => {
    const { sessionKeypair, walletAddress, signer, signedEntryXdr } = await runHeadlessSigning();

    // The signer is wired to the generated wallet address.
    expect(signer.address).toBe(walletAddress);
    expect(walletAddress.startsWith("C")).toBe(true);
    expect(walletAddress).toHaveLength(56);

    const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedEntryXdr, "base64");

    // Credentials stay V1 (NOT upgraded to V2 — hosted facilitators require V1).
    expect(signed.credentials().switch().name).toBe("sorobanCredentialsAddress");
    const creds = signed.credentials().address();
    expect(creds.signatureExpirationLedger()).toBe(1000);

    // Signature is the smart-wallet map: Vec[ Map[ SignerKey -> Signature ] ].
    const map = creds.signature().vec()?.[0]?.map();
    expect(map).toHaveLength(1);
    const key = map?.[0]?.key();
    const val = map?.[0]?.val();

    // SignerKey.Ed25519(pubkey) == the generated session key's raw public key.
    expect(key?.vec()?.[0]?.sym().toString()).toBe("Ed25519");
    expect(new Uint8Array(key?.vec()?.[1]?.bytes() ?? new Uint8Array())).toEqual(
      new Uint8Array(sessionKeypair.rawPublicKey()),
    );

    // Signature.Ed25519(sig) — 64 bytes.
    expect(val?.vec()?.[0]?.sym().toString()).toBe("Ed25519");
    const sig = val?.vec()?.[1]?.bytes();
    expect(sig).toHaveLength(64);
  });

  it("produces a signature that cryptographically verifies against the auth payload", async () => {
    const { sessionKeypair, signedEntryXdr } = await runHeadlessSigning();

    const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedEntryXdr, "base64");
    const creds = signed.credentials().address();

    // Recompute the payload the signer hashed and signed: the preimage does not
    // include the signature itself, so the signed entry reproduces it exactly.
    const preimage = buildAuthorizationEntryPreimage(
      signed,
      creds.signatureExpirationLedger(),
      TESTNET.networkPassphrase,
    );
    const payload = hash(preimage.toXDR());

    const sig = creds.signature().vec()?.[0]?.map()?.[0]?.val().vec()?.[1]?.bytes();
    expect(sig).toBeDefined();
    expect(sessionKeypair.verify(payload, sig as Buffer)).toBe(true);
  });

  it("generates a different key on every run", async () => {
    const a = await runHeadlessSigning();
    const b = await runHeadlessSigning();
    expect(a.sessionKeypair.publicKey()).not.toBe(b.sessionKeypair.publicKey());
    expect(a.walletAddress).not.toBe(b.walletAddress);
  });
});
