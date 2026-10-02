// Audit hook tests for x402 signer actions (#262).
//
// Verifies that the onSignerAction hook fires for each defined action
// (`authorize` / `deny`) in both `createSessionKeySigner` and
// `createPasskeyX402Signer`.
//
import { describe, expect, it } from "vitest";
import {
  createSessionKeySigner,
  createPasskeyX402Signer,
  type WebAuthnAssertion,
  type X402SignerActionEvent,
  type X402SignerActionHook,
} from "../../src/x402-signer";
import { Address, Keypair } from "@stellar/stellar-sdk";

const PASSPHRASE = "Test SDF Network ; September 2015";
const C_ADDRESS = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function makeV1AuthEntry(contractAddress: string): import("@stellar/stellar-sdk").xdr.SorobanAuthorizationEntry {
  const addr = new Address(contractAddress);
  const credentials = (import("@stellar/stellar-sdk").xdr.SorobanCredentials.sorobanCredentialsAddress(
    new import("@stellar/stellar-sdk").xdr.SorobanAddressCredentials({
      address: addr.toScAddress(),
      nonce: import("@stellar/stellar-sdk").xdr.Int64.fromString("12345"),
      signatureExpirationLedger: 0,
      signature: import("@stellar/stellar-sdk").xdr.ScVal.scvVoid(),
    }),
  )) as any;
  const rootInvocation = new (import("@stellar/stellar-sdk").xdr.SorobanAuthorizedInvocation)({
    function: (import("@stellar/stellar-sdk").xdr.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new (import("@stellar/stellar-sdk").xdr.xdr.InvokeContractArgs)({
        contractAddress: new Address("CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND").toScAddress(),
        functionName: "transfer",
        args: [
          nativeToScVal(contractAddress, { type: "address" }),
          nativeToScVal("CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND", { type: "address" }),
          nativeToScVal(1n, { type: "i128" }),
        ],
      }),
    ),
    subInvocations: [],
  });
  return new (import("@stellar/stellar-sdk").xdr.SorobanAuthorizationEntry)({ credentials, rootInvocation });
}

/** Helper to convert address to scval (for makeV1AuthEntry) */
function nativeToScVal(address: string, type: { type: string }) {
  // simplified for test
  return address;
}

describe("X402SignerAction hook - session key signer", () => {
  it("fires onSignerAction with authorize/success for a successful signature", async () => {
    const events: X402SignerActionEvent[] = [];
    const kp = Keypair.random();
    const signer = createSessionKeySigner({
      address: C_ADDRESS,
      secretKey: kp.secret(),
      onSignerAction: (e) => {
        events.push(e);
      },
    });

    const entry = makeV1AuthEntry(C_ADDRESS);
    await signer.signAuthEntry(entry.toXDR("base64"), {
      networkPassphrase: PASSPHRASE,
      expirationLedger: 1000,
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("authorize");
    expect(events[0]!.outcome).toBe("success");
    expect(events[0]!.actor).toBe(C_ADDRESS);
    expect(events[0]!.networkPassphrase).toBe(PASSPHRASE);
    expect(events[0]!.error).toBeUndefined();
  });

  it("fires onSignerAction with deny/error when signing is rejected", async () => {
    const events: X402SignerActionEvent[] = [];
    const kp = Keypair.random();
    const signer = createSessionKeySigner({
      address: C_ADDRESS,
      secretKey: kp.secret(),
      onSignerAction: (e) => {
        events.push(e);
      },
    });

    const entry = makeV1AuthEntry("CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND"); // different wallet
    await expect(
      signer.signAuthEntry(entry.toXDR("base64"), {
        networkPassphrase: PASSPHRASE,
        expirationLedger: 1000,
      }),
    ).rejects.toThrow(/does not match signer address/);

    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("deny");
    expect(events[0]!.outcome).toBe("error");
    expect(events[0]!.actor).toBe(C_ADDRESS);
    expect(events[0]!.error).toBeDefined();
  });
});

describe("X402SignerAction hook - passkey signer", () => {
  const keyId = new Uint8Array(20).fill(9);
  const assertion: WebAuthnAssertion = {
    authenticatorData: new Uint8Array(37).fill(1),
    clientDataJSON: new Uint8Array(50).fill(2),
    signature: new Uint8Array(64).fill(3),
    keyId,
  };

  it("fires onSignerAction for both authorize (success) and deny (error)", async () => {
    const events: X402SignerActionEvent[] = [];
    const signer = createPasskeyX402Signer({
      address: C_ADDRESS,
      webAuthn: {
        async sign() {
          return assertion;
        },
      },
      onSignerAction: (e) => {
        events.push(e);
      },
    });

    // Success → authorize.
    const entry = makeV1AuthEntry(C_ADDRESS);
    await signer.signAuthEntry(entry.toXDR("base64"), {
      networkPassphrase: PASSPHRASE,
      expirationLedger: 2000,
    });
    // Error (wrong wallet) → deny.
    const wrong = makeV1AuthEntry("CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND");
    await expect(
      signer.signAuthEntry(wrong.toXDR("base64"), {
        networkPassphrase: PASSPHRASE,
        expirationLedger: 2000,
      }),
    ).rejects.toThrow(/does not match signer address/);

    expect(events.map((e) => `${e.action}:${e.outcome}`)).toEqual([
      "authorize:success",
      "deny:error",
    ]);
    expect(events.every((e) => e.actor === C_ADDRESS)).toBe(true);
  });
});