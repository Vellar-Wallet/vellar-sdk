// Standalone example: a mock WebAuthnAssertionSigner that returns a fixed,
// canned assertion for any payload hash, for use in tests of the passkey
// x402 signer (createPasskeyX402Signer). See ./README.md — the returned
// assertion is NOT cryptographically valid.

import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  createPasskeyX402Signer,
  type WebAuthnAssertion,
  type WebAuthnAssertionSigner,
} from "../../../src/x402-signer";

/** A fixed, canned WebAuthn assertion. Every field is deterministic filler —
 * this is NOT a real secp256r1 signature and will NOT pass on-chain
 * verification. It exists purely to exercise code paths that consume a
 * `WebAuthnAssertionSigner` without a real browser/passkey ceremony. */
export const MOCK_ASSERTION: WebAuthnAssertion = {
  authenticatorData: new Uint8Array(37).fill(0xa1),
  clientDataJSON: new Uint8Array(50).fill(0xc1),
  signature: new Uint8Array(64).fill(0xf1),
  keyId: new Uint8Array(20).fill(0x99),
};

/** Builds a `WebAuthnAssertionSigner` that returns `MOCK_ASSERTION` for any
 * payload hash it's asked to sign — no browser, no real passkey involved. */
export function createMockWebAuthnAssertionSigner(): WebAuthnAssertionSigner {
  return {
    async sign(_payloadHash: Uint8Array): Promise<WebAuthnAssertion> {
      return MOCK_ASSERTION;
    },
  };
}

/** Builds a minimal V1 (`sorobanCredentialsAddress`) auth entry for
 * `contractAddress`, invoking a dummy `transfer` call — just enough
 * structure for `createPasskeyX402Signer` to sign. Mirrors the fixture used
 * in `src/x402-signer.test.ts`. */
function makeV1AuthEntry(contractAddress: string, otherContractAddress: string) {
  const addr = new Address(contractAddress);
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: addr.toScAddress(),
      nonce: xdr.Int64.fromString("1"),
      signatureExpirationLedger: 0,
      signature: xdr.ScVal.scvVoid(),
    }),
  );
  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(otherContractAddress).toScAddress(),
        functionName: "transfer",
        args: [
          nativeToScVal(contractAddress, { type: "address" }),
          nativeToScVal(otherContractAddress, { type: "address" }),
          nativeToScVal(1n, { type: "i128" }),
        ],
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
}

const PASSPHRASE = "Test SDF Network ; September 2015";
const WALLET_ADDRESS = "CC5ZSTLTYKPNIFDSJ4233RVZPALGHHDBRTXGIN6Z3AJCWU57VR5ITXXR";
const OTHER_ADDRESS = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";

/** Wires the mock signer into `createPasskeyX402Signer` and signs a dummy
 * V1 auth entry, returning the signed entry XDR. */
export async function signDummyEntryWithMock(): Promise<string> {
  const signer = createPasskeyX402Signer({
    address: WALLET_ADDRESS,
    webAuthn: createMockWebAuthnAssertionSigner(),
  });
  const entry = makeV1AuthEntry(WALLET_ADDRESS, OTHER_ADDRESS);
  return signer.signAuthEntry(entry.toXDR("base64"), {
    networkPassphrase: PASSPHRASE,
    expirationLedger: 1000,
  });
}

export async function main(): Promise<void> {
  const signedXdr = await signDummyEntryWithMock();
  console.log(`signed with mock WebAuthn assertion, entry XDR length: ${signedXdr.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
