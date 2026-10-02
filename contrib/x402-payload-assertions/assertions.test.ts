import { describe, expect, it } from "vitest";
import type { PaymentRequired, PaymentRequirements } from "../../src/x402-types";
import {
  assertAllOffered,
  assertPaymentRequired,
  assertPaymentRequirements,
  InvalidX402PayloadError,
} from "./assertions";

const TOKEN = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const CAIP2_TESTNET = "stellar:testnet";

function requirements(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: CAIP2_TESTNET,
    asset: TOKEN,
    amount: "1000000",
    payTo: "GDPAYTO234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCD",
    ...over,
  };
}

function decoded(accepts: PaymentRequirements[]): PaymentRequired {
  return { x402Version: 2, accepts };
}

describe("assertPaymentRequirements", () => {
  it("accepts a well-formed entry", () => {
    expect(() => assertPaymentRequirements(requirements())).not.toThrow();
  });

  it("rejects a non-object value", () => {
    expect(() => assertPaymentRequirements(null)).toThrow(InvalidX402PayloadError);
    expect(() => assertPaymentRequirements("nope")).toThrow(InvalidX402PayloadError);
  });

  it("lists every missing/malformed field", () => {
    try {
      assertPaymentRequirements({ scheme: "exact", network: CAIP2_TESTNET, amount: 5 });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidX402PayloadError);
      const problems = (err as InvalidX402PayloadError).problems;
      expect(problems).toContain("requirements.asset must be a non-empty string");
      expect(problems).toContain("requirements.amount must be a string");
      expect(problems).toContain("requirements.payTo must be a non-empty string");
    }
  });

  it("rejects a malformed maxTimeoutSeconds / extra", () => {
    expect(() =>
      assertPaymentRequirements(requirements({ maxTimeoutSeconds: "60" as unknown as number })),
    ).toThrow(InvalidX402PayloadError);
    expect(() =>
      assertPaymentRequirements(
        requirements({ extra: "nope" as unknown as Record<string, unknown> }),
      ),
    ).toThrow(InvalidX402PayloadError);
  });
});

describe("assertPaymentRequired", () => {
  it("accepts a well-formed challenge", () => {
    expect(() => assertPaymentRequired(decoded([requirements()]))).not.toThrow();
  });

  it("rejects a non-object payload", () => {
    expect(() => assertPaymentRequired(null)).toThrow(InvalidX402PayloadError);
    expect(() => assertPaymentRequired("nope")).toThrow(InvalidX402PayloadError);
  });

  it("rejects a missing accepts array", () => {
    try {
      assertPaymentRequired({ x402Version: 2 });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidX402PayloadError);
      expect((err as InvalidX402PayloadError).problems).toContain("accepts must be an array");
    }
  });

  it("does not deep-validate accepts entries (version-agnostic; x402 v1 payloads must decode too)", () => {
    expect(() =>
      assertPaymentRequired({ x402Version: 1, accepts: [{ scheme: "exact" }] }),
    ).not.toThrow();
  });
});

describe("assertAllOffered", () => {
  it("passes when every offered option is well-formed", () => {
    expect(() =>
      assertAllOffered(decoded([requirements(), requirements({ asset: "COTHER" })])),
    ).not.toThrow();
  });

  it("throws InvalidX402PayloadError when one offered option is malformed", () => {
    const bad = { scheme: "exact", network: CAIP2_TESTNET, asset: TOKEN, amount: "1000000" };
    expect(() =>
      assertAllOffered(decoded([bad as unknown as PaymentRequirements])),
    ).toThrow(InvalidX402PayloadError);
  });
});
