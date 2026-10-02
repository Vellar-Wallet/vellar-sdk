// Policy co-signers in the smart-account signature map.
//
// A policy-governed key that signs WITHOUT its policies is rejected by the
// wallet before the policy is ever consulted, which reads as a broken signer
// rather than a missing co-signer. These pin the map shape that works.

import { Address, Keypair, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { createSessionKeySigner } from "./x402-signer";

const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
const POLICY_A = "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3";
const POLICY_B = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PASSPHRASE = "Test SDF Network ; September 2015";

/** An unsigned V1 auth entry whose credential address is the wallet. */
function unsignedEntry(): string {
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(WALLET).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(POLICY_B).toScAddress(),
          functionName: "transfer",
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
  return entry.toXDR("base64");
}

/** The decoded `Vec[Map[key → sig]]` signature the signer produced. */
function signatureMapOf(signedXdr: string): xdr.ScMapEntry[] {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
  const sig = entry.credentials().address().signature();
  return sig.vec()![0]!.map()!;
}

const variantOf = (v: xdr.ScVal) => v.vec()![0]!.sym().toString();

async function sign(policies?: readonly string[]) {
  const signer = createSessionKeySigner({
    address: WALLET,
    secretKey: Keypair.random().secret(),
    ...(policies ? { policies } : {}),
  });
  return signatureMapOf(
    await signer.signAuthEntry(unsignedEntry(), {
      networkPassphrase: PASSPHRASE,
      expirationLedger: 1000,
    }),
  );
}

describe("policy co-signers in the signature map", () => {
  it("emits ed25519 only when no policies are configured", async () => {
    const entries = await sign();
    expect(entries).toHaveLength(1);
    expect(variantOf(entries[0]!.key())).toBe("Ed25519");
  });

  it("adds a Policy entry alongside the ed25519 signature", async () => {
    const entries = await sign([POLICY_A]);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => variantOf(e.key()))).toEqual(["Ed25519", "Policy"]);
  });

  it("carries the policy's address in the key and a unit Policy signature", async () => {
    const entries = await sign([POLICY_A]);
    const policyEntry = entries[1]!;
    const addr = Address.fromScVal(policyEntry.key().vec()![1]!).toString();
    expect(addr).toBe(POLICY_A);
    // The policy authorises by running, not by producing bytes.
    expect(policyEntry.val().vec()).toHaveLength(1);
    expect(variantOf(policyEntry.val())).toBe("Policy");
  });

  it("orders Ed25519 before Policy, as ScVal ordering requires", async () => {
    // Soroban rejects an unsorted map. "Ed25519" < "Policy" on the leading symbol.
    const entries = await sign([POLICY_A]);
    expect(variantOf(entries[0]!.key())).toBe("Ed25519");
    expect(variantOf(entries[1]!.key())).toBe("Policy");
  });

  it("orders multiple policies deterministically by address bytes", async () => {
    const forward = await sign([POLICY_A, POLICY_B]);
    const reversed = await sign([POLICY_B, POLICY_A]);
    const addrs = (es: xdr.ScMapEntry[]) =>
      es.slice(1).map((e) => Address.fromScVal(e.key().vec()![1]!).toString());

    // Configuration order must not change the emitted map.
    expect(addrs(forward)).toEqual(addrs(reversed));
    expect(addrs(forward)).toHaveLength(2);
  });

  it("rejects a policy address that is not a contract", async () => {
    expect(() =>
      createSessionKeySigner({
        address: WALLET,
        secretKey: Keypair.random().secret(),
        policies: ["GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU"],
      }),
    ).toThrow(/policy address must be a contract/);
  });
});
