// Fuzz tests for x402-auth-entry validation (issue #442).
//
// The existing src/x402-auth-entry.test.ts constructs well-formed entries with
// one field altered. These tests cover a different input class: structurally
// hostile XDR — wrong ScVal types, deep nesting, i128 boundaries, truncated
// buffers. Every case asserts the error TYPE and FIELD, never merely that
// something threw.

import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { AuthEntryMismatchError, assertAuthEntryInvocation } from "../../src/x402-auth-entry";

const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PAYTO = "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU";

const expected = {
  contract: TOKEN,
  functionName: "transfer",
  from: WALLET,
  to: PAYTO,
  amount: 1_000_000n,
};

/** Build a well-formed entry credentialed to WALLET, with optional overrides. */
function entry(
  over: {
    contract?: string;
    fn?: string;
    args?: xdr.ScVal[];
    subInvocations?: xdr.SorobanAuthorizedInvocation[];
  } = {},
): xdr.SorobanAuthorizationEntry {
  const args =
    over.args ?? [
      nativeToScVal(WALLET, { type: "address" }),
      nativeToScVal(PAYTO, { type: "address" }),
      nativeToScVal(1_000_000n, { type: "i128" }),
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

// ── Wrong ScVal types in each arg position ────────────────────────────────

describe("wrong ScVal types in the args array", () => {
  it("refuses a string where the from address is expected", () => {
    try {
      assertAuthEntryInvocation(
        entry({
          args: [
            nativeToScVal("not-an-address"),
            nativeToScVal(PAYTO, { type: "address" }),
            nativeToScVal(1_000_000n, { type: "i128" }),
          ],
        }),
        expected,
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEntryMismatchError);
      expect((err as AuthEntryMismatchError).field).toBe("from");
    }
  });

  it("refuses a u32 where the to address is expected", () => {
    try {
      assertAuthEntryInvocation(
        entry({
          args: [
            nativeToScVal(WALLET, { type: "address" }),
            xdr.ScVal.scvU32(42),
            nativeToScVal(1_000_000n, { type: "i128" }),
          ],
        }),
        expected,
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEntryMismatchError);
      // addressOf passes "to" as the field name; "to (recipient)" is used
      // only when the address is parseable but doesn't match.
      expect((err as AuthEntryMismatchError).field).toBe("to");
    }
  });

  it("refuses a bool where the amount i128 is expected", () => {
    try {
      assertAuthEntryInvocation(
        entry({
          args: [
            nativeToScVal(WALLET, { type: "address" }),
            nativeToScVal(PAYTO, { type: "address" }),
            xdr.ScVal.scvBool(true),
          ],
        }),
        expected,
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEntryMismatchError);
      expect((err as AuthEntryMismatchError).field).toBe("amount");
    }
  });

  it("refuses a map where the from address is expected", () => {
    try {
      assertAuthEntryInvocation(
        entry({
          args: [
            xdr.ScVal.scvMap([
              new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol("k"),
                val: xdr.ScVal.scvU32(1),
              }),
            ]),
            nativeToScVal(PAYTO, { type: "address" }),
            nativeToScVal(1_000_000n, { type: "i128" }),
          ],
        }),
        expected,
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEntryMismatchError);
      expect((err as AuthEntryMismatchError).field).toBe("from");
    }
  });

  it("refuses a vec where the amount i128 is expected", () => {
    try {
      assertAuthEntryInvocation(
        entry({
          args: [
            nativeToScVal(WALLET, { type: "address" }),
            nativeToScVal(PAYTO, { type: "address" }),
            xdr.ScVal.scvVec([xdr.ScVal.scvU32(1), xdr.ScVal.scvU32(2)]),
          ],
        }),
        expected,
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEntryMismatchError);
      expect((err as AuthEntryMismatchError).field).toBe("amount");
    }
  });
});

// ── Deeply nested sub-invocations ─────────────────────────────────────────

describe("deeply nested sub-invocations", () => {
  function makeInvocation(depth: number): xdr.SorobanAuthorizedInvocation {
    const leaf = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(TOKEN).toScAddress(),
          functionName: "transfer",
          args: [
            nativeToScVal(WALLET, { type: "address" }),
            nativeToScVal(PAYTO, { type: "address" }),
            nativeToScVal(500_000n, { type: "i128" }),
          ],
        }),
      ),
      subInvocations: [],
    });

    let current = leaf;
    for (let i = 0; i < depth; i++) {
      current = new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(TOKEN).toScAddress(),
            functionName: "transfer",
            args: [
              nativeToScVal(WALLET, { type: "address" }),
              nativeToScVal(PAYTO, { type: "address" }),
              nativeToScVal(1n, { type: "i128" }),
            ],
          }),
        ),
        subInvocations: [current],
      });
    }

    return current;
  }

  it("refuses a single nested sub-invocation at depth 1", () => {
    expect(() =>
      assertAuthEntryInvocation(entry({ subInvocations: [makeInvocation(0)] }), expected),
    ).toThrow(/sub-invocations/);
  });

  it("refuses nested sub-invocations at depth 3", () => {
    expect(() =>
      assertAuthEntryInvocation(entry({ subInvocations: [makeInvocation(3)] }), expected),
    ).toThrow(/sub-invocations/);
  });

  it("refuses nested sub-invocations at depth 10", () => {
    expect(() =>
      assertAuthEntryInvocation(entry({ subInvocations: [makeInvocation(10)] }), expected),
    ).toThrow(/sub-invocations/);
  });

  it("refuses multiple sibling sub-invocations", () => {
    expect(() =>
      assertAuthEntryInvocation(
        entry({ subInvocations: [makeInvocation(0), makeInvocation(0), makeInvocation(0)] }),
        expected,
      ),
    ).toThrow(/sub-invocations/);
  });
});

// ── i128 boundary amounts ─────────────────────────────────────────────────

describe("i128 boundary amounts", () => {
  const I128_MAX = (1n << 127n) - 1n;
  const I128_MIN = -(1n << 127n);

  it("refuses the maximum i128 value when expected is smaller", () => {
    try {
      assertAuthEntryInvocation(entry({ args: undefined }), {
        ...expected,
        amount: I128_MAX,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEntryMismatchError);
      expect((err as AuthEntryMismatchError).field).toBe("amount");
    }
  });

  it("accepts the maximum i128 when expected matches", () => {
    expect(() =>
      assertAuthEntryInvocation(
        entry({
          args: [
            nativeToScVal(WALLET, { type: "address" }),
            nativeToScVal(PAYTO, { type: "address" }),
            nativeToScVal(I128_MAX, { type: "i128" }),
          ],
        }),
        { ...expected, amount: I128_MAX },
      ),
    ).not.toThrow();
  });

  it("refuses a negative amount", () => {
    try {
      assertAuthEntryInvocation(
        entry({
          args: [
            nativeToScVal(WALLET, { type: "address" }),
            nativeToScVal(PAYTO, { type: "address" }),
            nativeToScVal(-1n, { type: "i128" }),
          ],
        }),
        expected,
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEntryMismatchError);
      expect((err as AuthEntryMismatchError).field).toBe("amount");
    }
  });

  it("accepts the minimum (most negative) i128 when expected matches", () => {
    expect(() =>
      assertAuthEntryInvocation(
        entry({
          args: [
            nativeToScVal(WALLET, { type: "address" }),
            nativeToScVal(PAYTO, { type: "address" }),
            nativeToScVal(I128_MIN, { type: "i128" }),
          ],
        }),
        { ...expected, amount: I128_MIN },
      ),
    ).not.toThrow();
  });

  it("refuses zero when expected is non-zero", () => {
    try {
      assertAuthEntryInvocation(
        entry({
          args: [
            nativeToScVal(WALLET, { type: "address" }),
            nativeToScVal(PAYTO, { type: "address" }),
            nativeToScVal(0n, { type: "i128" }),
          ],
        }),
        expected,
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEntryMismatchError);
      expect((err as AuthEntryMismatchError).field).toBe("amount");
    }
  });
});

// ── Truncated and structurally invalid XDR ────────────────────────────────

describe("truncated and structurally invalid XDR", () => {
  it("refuses an empty buffer without crashing", () => {
    expect(() => {
      const entry = xdr.SorobanAuthorizationEntry.fromXDR(Buffer.alloc(0));
      assertAuthEntryInvocation(entry, expected);
    }).toThrow();
  });

  it("refuses a single-byte buffer without crashing", () => {
    expect(() => {
      const entry = xdr.SorobanAuthorizationEntry.fromXDR(Buffer.from([0x00]));
      assertAuthEntryInvocation(entry, expected);
    }).toThrow();
  });

  it("refuses random bytes without crashing", () => {
    const random = Buffer.alloc(64);
    for (let i = 0; i < random.length; i++) random[i] = Math.floor(Math.random() * 256);
    expect(() => {
      const entry = xdr.SorobanAuthorizationEntry.fromXDR(random);
      assertAuthEntryInvocation(entry, expected);
    }).toThrow();
  });

  it("refuses a truncated valid entry without crashing", () => {
    const valid = entry().toXDR();
    const half = valid.slice(0, Math.floor(valid.length / 2));
    expect(() => {
      const entry = xdr.SorobanAuthorizationEntry.fromXDR(half);
      assertAuthEntryInvocation(entry, expected);
    }).toThrow();
  });

  it("never returns normally on input it could not fully parse", () => {
    // Any structurally invalid input must throw — not silently pass validation.
    const garbage = Buffer.from("this is not XDR at all");
    expect(() => {
      const entry = xdr.SorobanAuthorizationEntry.fromXDR(garbage);
      assertAuthEntryInvocation(entry, expected);
    }).toThrow();
  });
});