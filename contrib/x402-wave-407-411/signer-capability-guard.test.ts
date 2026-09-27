import { describe, expect, it, vi } from "vitest";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { CapabilityDeniedError, InvalidCapabilityRuleError } from "../../src/x402-signer-capabilities";
import type { SmartAccountX402Signer } from "../../src/x402-types";
import { withCapabilityGuard } from "./signer-capability-guard";

const PASSPHRASE = "Test SDF Network ; September 2015";
const C_ADDRESS = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const OTHER_C = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";

function makeV1AuthEntry(contractAddress: string): xdr.SorobanAuthorizationEntry {
  const addr = new Address(contractAddress);
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: addr.toScAddress(),
      nonce: xdr.Int64.fromString("12345"),
      signatureExpirationLedger: 0,
      signature: xdr.ScVal.scvVoid(),
    }),
  );
  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(OTHER_C).toScAddress(),
        functionName: "transfer",
        args: [
          nativeToScVal(contractAddress, { type: "address" }),
          nativeToScVal(OTHER_C, { type: "address" }),
          nativeToScVal(1n, { type: "i128" }),
        ],
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
}

function stubSigner(): SmartAccountX402Signer {
  return {
    address: C_ADDRESS,
    signAuthEntry: vi.fn(async (entryXdr) => entryXdr),
  };
}

describe("withCapabilityGuard (#408)", () => {
  it("signs as before when no capabilities are configured (backward compatible)", async () => {
    const inner = stubSigner();
    const signer = withCapabilityGuard(inner);
    const entry = makeV1AuthEntry(C_ADDRESS);
    await expect(
      signer.signAuthEntry(entry.toXDR("base64"), {
        networkPassphrase: PASSPHRASE,
        expirationLedger: 1000,
      }),
    ).resolves.toBeDefined();
    expect(inner.signAuthEntry).toHaveBeenCalledTimes(1);
  });

  it("throws when signAuthEntry is called directly with an entry outside capabilities", async () => {
    // Bypasses x402-client.ts entirely: the check lives on the signer wrapper.
    const inner = stubSigner();
    const signer = withCapabilityGuard(inner, [{ resourceType: C_ADDRESS, action: "transfer" }]);
    const entry = makeV1AuthEntry(C_ADDRESS); // invocation is on OTHER_C
    await expect(
      signer.signAuthEntry(entry.toXDR("base64"), {
        networkPassphrase: PASSPHRASE,
        expirationLedger: 1000,
      }),
    ).rejects.toBeInstanceOf(CapabilityDeniedError);
    expect(inner.signAuthEntry).not.toHaveBeenCalled();
  });

  it("signs when the invocation matches a configured capability rule", async () => {
    const inner = stubSigner();
    const signer = withCapabilityGuard(inner, [{ resourceType: OTHER_C, action: "transfer" }]);
    const entry = makeV1AuthEntry(C_ADDRESS);
    await expect(
      signer.signAuthEntry(entry.toXDR("base64"), {
        networkPassphrase: PASSPHRASE,
        expirationLedger: 1000,
      }),
    ).resolves.toBeDefined();
    expect(inner.signAuthEntry).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed capability rule at construction, before any sign attempt", () => {
    expect(() =>
      withCapabilityGuard(stubSigner(), [{ resourceType: "not-a-contract", action: "transfer" }]),
    ).toThrow(InvalidCapabilityRuleError);
  });
});
