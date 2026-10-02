// V-1 regression tests.
//
// The end-to-end proof — a stub RPC that returns a redirected recipient and is
// refused — lives in packages/mcp-x402-payer/test/hostile-rpc.test.ts, because
// only there is there a client to drive. These cover the validator's own
// semantics, including the cases a careless implementation gets wrong.

import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { AuthEntryMismatchError, assertAuthEntryInvocation } from "./x402-auth-entry";

const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PAYTO = "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU";
const ATTACKER = "GB74DDOZVF4SX3SEB2HNXJTKDBEKI4PH7N6GUWAFLG76XJBX27AOW2YB";

const expected = {
  contract: TOKEN,
  functionName: "transfer",
  from: WALLET,
  to: PAYTO,
  amount: 1_000_000n,
};

/** An auth entry credentialed to WALLET — i.e. one that passes the address check. */
function entry(
  over: {
    contract?: string;
    fn?: string;
    from?: string;
    to?: string;
    amount?: bigint;
    args?: xdr.ScVal[];
    subInvocations?: xdr.SorobanAuthorizedInvocation[];
  } = {},
): xdr.SorobanAuthorizationEntry {
  const args =
    over.args ??
    [
      nativeToScVal(over.from ?? WALLET, { type: "address" }),
      nativeToScVal(over.to ?? PAYTO, { type: "address" }),
      nativeToScVal(over.amount ?? 1_000_000n, { type: "i128" }),
    ];

  return new xdr.SorobanAuthorizationEntry({
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
          contractAddress: new Address(over.contract ?? TOKEN).toScAddress(),
          functionName: over.fn ?? "transfer",
          args,
        }),
      ),
      subInvocations: over.subInvocations ?? [],
    }),
  });
}

describe("assertAuthEntryInvocation", () => {
  it("accepts the payment we intended", () => {
    expect(() => assertAuthEntryInvocation(entry(), expected)).not.toThrow();
  });

  it("REFUSES a redirected recipient — the attack the on-chain policy cannot catch", () => {
    // The spending policy validates token and amount, not the recipient, so this
    // entry would satisfy __check_auth completely.
    try {
      assertAuthEntryInvocation(entry({ to: ATTACKER }), expected);
      expect.unreachable("signed a redirected payment");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEntryMismatchError);
      expect((err as AuthEntryMismatchError).field).toBe("to (recipient)");
      expect((err as Error).message).toContain(ATTACKER);
    }
  });

  it("refuses a different token contract", () => {
    expect(() => assertAuthEntryInvocation(entry({ contract: WALLET }), expected)).toThrow(
      /contract expected/,
    );
  });

  it("refuses a different function", () => {
    expect(() => assertAuthEntryInvocation(entry({ fn: "burn" }), expected)).toThrow(
      /function expected transfer, got burn/,
    );
  });

  it("refuses an inflated amount", () => {
    expect(() => assertAuthEntryInvocation(entry({ amount: 999_999_999n }), expected)).toThrow(
      /amount expected 1000000, got 999999999/,
    );
  });

  it("refuses a substituted payer", () => {
    expect(() => assertAuthEntryInvocation(entry({ from: ATTACKER }), expected)).toThrow(/from/);
  });

  it("refuses sub-invocations — signing the root authorises those too", () => {
    const sneaky = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(TOKEN).toScAddress(),
          functionName: "transfer",
          args: [
            nativeToScVal(WALLET, { type: "address" }),
            nativeToScVal(ATTACKER, { type: "address" }),
            nativeToScVal(500_000n, { type: "i128" }),
          ],
        }),
      ),
      subInvocations: [],
    });

    // Root looks perfect; the theft is underneath it.
    expect(() =>
      assertAuthEntryInvocation(entry({ subInvocations: [sneaky] }), expected),
    ).toThrow(/sub-invocations/);
  });

  it("refuses a wrong argument count", () => {
    expect(() =>
      assertAuthEntryInvocation(entry({ args: [nativeToScVal(WALLET, { type: "address" })] }), expected),
    ).toThrow(/argument count/);
  });

  it("refuses non-address arguments rather than coercing them", () => {
    expect(() =>
      assertAuthEntryInvocation(
        entry({
          args: [
            nativeToScVal("not-an-address"),
            nativeToScVal(PAYTO, { type: "address" }),
            nativeToScVal(1_000_000n, { type: "i128" }),
          ],
        }),
        expected,
      ),
    ).toThrow(/from expected an address/);
  });

  it("names the field, so a failure is diagnosable rather than opaque", () => {
    try {
      assertAuthEntryInvocation(entry({ to: ATTACKER }), expected);
    } catch (err) {
      const e = err as AuthEntryMismatchError;
      expect(e.expected).toBe(PAYTO);
      expect(e.actual).toBe(ATTACKER);
    }
  });
});
