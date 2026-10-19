import { describe, expect, it } from "vitest";
import * as A from "@stellar/stellar-sdk";
import { isValidStellarAddress } from "../../src/tx-rpc";
import {
  assertSameStellarSdkInstance,
  loadIsolatedStellarSdk,
  StellarSdkInstanceMismatchError,
} from "./dual-stellar-sdk";

const PASSPHRASE = "Test SDF Network ; September 2015";
const C_ADDRESS = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const OTHER_C = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";

type Sdk = typeof A;

function buildTx(sdk: Sdk) {
  const kp = sdk.Keypair.random();
  return new sdk.TransactionBuilder(new sdk.Account(kp.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(sdk.Operation.bumpSequence({ bumpTo: "5" }))
    .setTimeout(30)
    .build();
}

function buildAuthEntry(sdk: Sdk) {
  const { Address, xdr } = sdk;
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(C_ADDRESS).toScAddress(),
        nonce: xdr.Int64.fromString("12345"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(OTHER_C).toScAddress(),
          functionName: "transfer",
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
}

describe("dual @stellar/stellar-sdk instances (issue #639)", () => {
  const B = loadIsolatedStellarSdk();

  describe("harness", () => {
    it("loads a second copy whose classes are distinct from the first", () => {
      expect(B).not.toBe(A);
      expect(B.Address).not.toBe(A.Address);
      expect(B.xdr).not.toBe(A.xdr);
      expect(buildTx(B) instanceof A.Transaction).toBe(false);
    });
  });

  describe("observed cross-instance behaviour (what actually happens)", () => {
    it("rejects an Address built by the other instance", () => {
      expect(() => new B.Address(new A.Address(C_ADDRESS) as never)).toThrow();
    });

    it("rejects a Transaction object built by the other instance", () => {
      expect(() => B.TransactionBuilder.fromXDR(buildTx(A) as never, PASSPHRASE)).toThrow();
    });

    it("fails instanceof for classes from the other instance", () => {
      expect(buildTx(A) instanceof B.Transaction).toBe(false);
      expect(new A.Address(C_ADDRESS) instanceof B.Address).toBe(false);
    });

    it("tolerates mixing raw xdr structures, so it can silently succeed", () => {
      const entry = buildAuthEntry(A);
      const foreign = B.xdr.ScVal.scvVec([B.xdr.ScVal.scvSymbol("y")]);
      expect(() => entry.credentials().address().signature(foreign)).not.toThrow();
      expect(() => entry.toXDR("base64")).not.toThrow();
    });
  });

  describe("SDK entry points are safe across instances because they take strings", () => {
    it("isValidStellarAddress works for a strkey produced by the other instance", () => {
      const g = B.Keypair.random().publicKey();
      expect(isValidStellarAddress(g)).toBe(true);
      expect(isValidStellarAddress(new B.Address(C_ADDRESS).toString())).toBe(true);
    });
  });

  describe("assertSameStellarSdkInstance", () => {
    it("accepts a value from the same instance", () => {
      expect(() => assertSameStellarSdkInstance(buildTx(A), A.Transaction, "tx")).not.toThrow();
    });

    it("throws StellarSdkInstanceMismatchError naming the duplicate-install fix for the other instance", () => {
      const err = (() => {
        try {
          assertSameStellarSdkInstance(buildTx(B), A.Transaction, "tx");
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(StellarSdkInstanceMismatchError);
      expect((err as Error).message).toContain("tx");
      expect((err as Error).message).toMatch(/two copies of @stellar\/stellar-sdk/);
      expect((err as Error).message).toContain("npm dedupe");
    });

    it("throws a plain TypeError for a value that is not that type at all", () => {
      expect(() => assertSameStellarSdkInstance("GABC", A.Transaction, "tx")).toThrow(TypeError);
      expect(() => assertSameStellarSdkInstance(null, A.Transaction, "tx")).toThrow(TypeError);
      expect(() => assertSameStellarSdkInstance({}, A.Transaction, "tx")).toThrow(TypeError);
      expect(() => assertSameStellarSdkInstance({}, A.Transaction, "tx")).not.toThrow(
        StellarSdkInstanceMismatchError,
      );
    });
  });
});
