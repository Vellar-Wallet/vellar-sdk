import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import {
  createMockWebAuthnAssertionSigner,
  MOCK_ASSERTION,
  signDummyEntryWithMock,
} from "./mock-webauthn-assertion";

describe("createMockWebAuthnAssertionSigner", () => {
  it("returns the fixed canned assertion for any payload hash", async () => {
    const signer = createMockWebAuthnAssertionSigner();
    const a = await signer.sign(new Uint8Array(32).fill(1));
    const b = await signer.sign(new Uint8Array(32).fill(2));
    expect(a).toEqual(MOCK_ASSERTION);
    expect(b).toEqual(MOCK_ASSERTION);
    expect(a.authenticatorData).toHaveLength(37);
    expect(a.clientDataJSON).toHaveLength(50);
    expect(a.signature).toHaveLength(64);
    expect(a.keyId).toHaveLength(20);
  });
});

describe("signDummyEntryWithMock", () => {
  it("wires the mock into createPasskeyX402Signer and produces a signed V1 entry", async () => {
    const signedXdr = await signDummyEntryWithMock();
    const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
    expect(signed.credentials().switch().name).toBe("sorobanCredentialsAddress");

    const map = signed.credentials().address().signature().vec()![0]!.map()!;
    const key = map[0]!.key();
    expect(key.vec()![0]!.sym().toString()).toBe("Secp256r1");
    expect(new Uint8Array(key.vec()![1]!.bytes())).toEqual(MOCK_ASSERTION.keyId);
  });
});
