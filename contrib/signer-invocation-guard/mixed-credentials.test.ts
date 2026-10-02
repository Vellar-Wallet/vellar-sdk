import { describe, expect, it } from "vitest";
import { Address, Keypair, xdr } from "@stellar/stellar-sdk";

const C_ADDRESS = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const PAYTO = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const TOKEN = "CB222222222222222222222222222222222222222222222222222222";

function makeSourceAccountAuthEntry(sourceAddress: string): xdr.SorobanAuthorizationEntry {
  const rootFn = xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(TOKEN).toScAddress(),
      functionName: "transfer",
      args: [
        Address.fromString(C_ADDRESS).toScVal(),
        Address.fromString(PAYTO).toScVal(),
        xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString("100"), hi: xdr.Int64.fromString("0") })),
      ],
    }),
  );
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: rootFn,
      subInvocations: [],
    }),
  });
}

function makeAddressAuthEntry(smartAccountAddr: string): xdr.SorobanAuthorizationEntry {
  const rootFn = xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(TOKEN).toScAddress(),
      functionName: "transfer",
      args: [
        Address.fromString(smartAccountAddr).toScVal(),
        Address.fromString(PAYTO).toScVal(),
        xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString("100"), hi: xdr.Int64.fromString("0") })),
      ],
    }),
  );
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanCredentialsAddress({
        address: Address.fromString(smartAccountAddr).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 1000,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: rootFn,
      subInvocations: [],
    }),
  });
}

describe("Mixed Credential Auth Entries (#384)", () => {
  it("filters and processes mixed credential entries safely without throwing on sourceAccount credentials", async () => {
    const sourceAccountAddr = Keypair.random().publicKey();
    const sourceEntry = makeSourceAccountAuthEntry(sourceAccountAddr);
    const addressEntry = makeAddressAuthEntry(C_ADDRESS);

    const entries = [sourceEntry, addressEntry];
    let signedCount = 0;

    const mockSigner = {
      address: C_ADDRESS,
      async signAuthEntry(entryXdr: string) {
        signedCount++;
        return entryXdr;
      },
    };

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.credentials().switch().name !== "sorobanCredentialsAddress") continue;
      const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
      if (addr !== mockSigner.address) continue;
      await mockSigner.signAuthEntry(entry.toXDR("base64"));
    }

    expect(signedCount).toBe(1);
  });
});
