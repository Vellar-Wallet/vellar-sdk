import { describe, expect, it } from "vitest";
import { Address, Keypair, xdr } from "@stellar/stellar-sdk";
import { createSessionKeySigner } from "../../src/x402-signer";
import { AuthEntryMismatchError } from "../../src/x402-auth-entry";
import { withSignerInvocationGuard } from "./signer-invocation-guard";

const PASSPHRASE = "Test SDF Network ; September 2015";
const C_ADDRESS = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const OTHER_C = "CB222222222222222222222222222222222222222222222222222222";
const PAYTO = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function makeV1AuthEntry(address: string): xdr.SorobanAuthorizationEntry {
  const rootFn: xdr.SorobanAuthorizedFunction =
    xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(OTHER_C).toScAddress(),
        functionName: "transfer",
        args: [
          Address.fromString(address).toScVal(),
          Address.fromString(PAYTO).toScVal(),
          xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString("100"), hi: xdr.Int64.fromString("0") })),
        ],
      }),
    );
  const rootInv: xdr.SorobanAuthorizedInvocation = new xdr.SorobanAuthorizedInvocation({
    function: rootFn,
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanCredentialsAddress({
        address: Address.fromString(address).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 1000,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: rootInv,
  });
}

describe("withSignerInvocationGuard (#382)", () => {
  it("refuses to sign when entry does not match expectedInvocation (redirected recipient)", async () => {
    const kp = Keypair.random();
    const rawSigner = createSessionKeySigner({ address: C_ADDRESS, secretKey: kp.secret() });
    const signer = withSignerInvocationGuard(rawSigner);
    const entry = makeV1AuthEntry(C_ADDRESS);

    const expectedRedirectedRecipient = {
      contract: OTHER_C,
      functionName: "transfer",
      from: C_ADDRESS,
      to: "CCATTACKERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      amount: 100n,
    };

    await expect(
      signer.signAuthEntry(entry.toXDR("base64"), {
        networkPassphrase: PASSPHRASE,
        expirationLedger: 1000,
        expectedInvocation: expectedRedirectedRecipient,
      }),
    ).rejects.toThrow(AuthEntryMismatchError);
  });

  it("successfully signs when expectedInvocation matches entry exactly", async () => {
    const kp = Keypair.random();
    const rawSigner = createSessionKeySigner({ address: C_ADDRESS, secretKey: kp.secret() });
    const signer = withSignerInvocationGuard(rawSigner);
    const entry = makeV1AuthEntry(C_ADDRESS);

    const expectedExact = {
      contract: OTHER_C,
      functionName: "transfer",
      from: C_ADDRESS,
      to: PAYTO,
      amount: 100n,
    };

    const signedXdr = await signer.signAuthEntry(entry.toXDR("base64"), {
      networkPassphrase: PASSPHRASE,
      expirationLedger: 1000,
      expectedInvocation: expectedExact,
    });

    expect(signedXdr).toBeDefined();
    expect(typeof signedXdr).toBe("string");
  });
});
