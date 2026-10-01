// Tests for the PURE x402 decision layer — boundary conditions for issue #271.
// No network, no signer, no stellar-sdk.
// Contributed as per contrib/ rules; tests run via the project's existing vitest suite.

import { describe, expect, it } from "vitest";
import {
  base64ToUtf8,
  decodePaymentRequired,
  decodeSettlementHeader,
  extractRejectionReason,
  parseAmount,
  selectRequirements,
  utf8ToBase64,
} from "../src/x402-guards";
import {
  DisallowedAssetError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
} from "../src/x402-types";
import { CAIP2_TESTNET, TOKEN, b64, decoded, requirements, response402 } from "../src/x402-test-fixtures";

const ALLOWED = "CALLOWEDASSET34567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567X";

describe("base64 helpers", () => {
  it("round-trips non-ASCII without Buffer", () => {
    const s = '{"note":"café · 数字 · 🜲"}';
    expect(base64ToUtf8(utf8ToBase64(s))).toBe(s);
  });
});

describe("parseAmount", () => {
  it("parses a valid decimal string", () => {
    expect(parseAmount("1000000")).toBe(1000000n);
  });

  it("parses zero", () => {
    expect(parseAmount("0")).toBe(0n);
  });

  it("throws InvalidRequirementsError on a negative amount", () => {
    expect(() => parseAmount("-1")).toThrow(InvalidRequirementsError);
  });

  it("throws InvalidRequirementsError on a fractional decimal", () => {
    expect(() => parseAmount("1.5")).toThrow(InvalidRequirementsError);
  });

  it("throws InvalidRequirementsError on non-numeric strings", () => {
    expect(() => parseAmount("abc")).toThrow(InvalidRequirementsError);
    expect(() => parseAmount("")).toThrow(InvalidRequirementsError);
  });
});

describe("decodePaymentRequired", () => {
  it("decodes a valid PAYMENT-REQUIRED base64 header", () => {
    const decoded = decodePaymentRequired(response402([requirements()]));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts).toHaveLength(1);
  });

  it("throws Malformed error on invalid base64", () => {
    const res = new Response("{}", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": "!!!not-base64!!!" },
    });
    expect(() => decodePaymentRequired(res)).toThrow(/Malformed PAYMENT-REQUIRED/);
  });

  it("throws on a header that decodes to non-JSON", () => {
    const res = new Response("{}", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": utf8ToBase64("not json at all") },
    });
    expect(() => decodePaymentRequired(res)).toThrow(NoUsablePaymentOptionError);
  });
});

describe("selectRequirements", () => {
  it("picks a later ALLOWED asset even when a disallowed one is offered first", () => {
    const picked = selectRequirements(
      decoded([
        requirements({ asset: TOKEN, amount: "1000000" }),
        requirements({ asset: ALLOWED, amount: "2000000" }),
      ]),
      { maxAmount: 10_000_000n, allowedAssets: [ALLOWED] },
      CAIP2_TESTNET,
    );
    expect(picked.asset).toBe(ALLOWED);
  });

  it("throws DisallowedAssetError only when NO offered asset is allowed", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ asset: TOKEN }), requirements({ asset: "COTHER" })]),
        { maxAmount: 10_000_000n, allowedAssets: ["CNONE"] },
        CAIP2_TESTNET,
      ),
    ).toThrow(DisallowedAssetError);
  });

  it("picks the cheapest allowed option when several are offered (no overpaying)", () => {
    const picked = selectRequirements(
      decoded([
        requirements({ asset: TOKEN, amount: "5000000" }),
        requirements({ asset: TOKEN, amount: "1000000" }),
      ]),
      { maxAmount: 10_000_000n },
      CAIP2_TESTNET,
    );
    expect(picked.amount).toBe("1000000");
  });

  it("enforces maxAmount on the chosen option", () => {
    expect(() =>
      selectRequirements(decoded([requirements({ amount: "9999999" })]), { maxAmount: 1n }, CAIP2_TESTNET),
    ).toThrow(MaxAmountExceededError);
  });

  // ── Boundary condition tests (issue #271) ─────────────────────────────────

  it("allows an amount exactly equal to maxAmount", () => {
    const picked = selectRequirements(
      decoded([requirements({ amount: "1000000" })]),
      { maxAmount: 1_000_000n },
      CAIP2_TESTNET,
    );
    expect(picked.amount).toBe("1000000");
  });

  it("throws on an amount just over the maxAmount limit", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ amount: "1000001" })]),
        { maxAmount: 1_000_000n },
        CAIP2_TESTNET,
      ),
    ).toThrow(MaxAmountExceededError);
  });

  it("handles a zero amount input correctly in selectRequirements", () => {
    const picked = selectRequirements(
      decoded([requirements({ amount: "0" })]),
      { maxAmount: 1_000_000n },
      CAIP2_TESTNET,
    );
    expect(picked.amount).toBe("0");
  });

  it("throws on a negative amount input in selectRequirements", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ amount: "-5" })]),
        { maxAmount: 1_000_000n },
        CAIP2_TESTNET,
      ),
    ).toThrow(InvalidRequirementsError);
  });

  it("throws when no option is on our network", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ network: "eip155:1" })]),
        { maxAmount: 10_000_000n },
        CAIP2_TESTNET,
      ),
    ).toThrow(NoUsablePaymentOptionError);
  });

  it("throws when the scheme is not `exact`", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ scheme: "upto" })]),
        { maxAmount: 10_000_000n },
        CAIP2_TESTNET,
      ),
    ).toThrow(NoUsablePaymentOptionError);
  });

  it("throws on an empty accepts list", () => {
    expect(() => selectRequirements(decoded([]), { maxAmount: 10n }, CAIP2_TESTNET)).toThrow(
      NoUsablePaymentOptionError,
    );
  });

  it("skips an unsponsored option and picks a sponsored one", () => {
    const picked = selectRequirements(
      decoded([
        requirements({ asset: TOKEN, extra: { areFeesSponsored: false } }),
        requirements({ asset: ALLOWED, extra: { areFeesSponsored: true } }),
      ]),
      { maxAmount: 10_000_000n },
      CAIP2_TESTNET,
    );
    expect(picked.asset).toBe(ALLOWED);
  });

  it("refuses an option that declares areFeesSponsored=false", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ extra: { areFeesSponsored: false } })]),
        { maxAmount: 10_000_000n },
        CAIP2_TESTNET,
      ),
    ).toThrow(/do not sponsor fees/);
  });

  it("refuses an option with no `extra` at all, rather than crashing downstream", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ extra: undefined })]),
        { maxAmount: 10_000_000n },
        CAIP2_TESTNET,
      ),
    ).toThrow(/did not declare areFeesSponsored=true/);
  });

  it("refuses an option whose `extra` omits areFeesSponsored", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ extra: { somethingElse: 1 } })]),
        { maxAmount: 10_000_000n },
        CAIP2_TESTNET,
      ),
    ).toThrow(NoUsablePaymentOptionError);
  });

  it("refuses a truthy-but-not-true areFeesSponsored", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ extra: { areFeesSponsored: "yes" } })]),
        { maxAmount: 10_000_000n },
        CAIP2_TESTNET,
      ),
    ).toThrow(NoUsablePaymentOptionError);
  });

  it("propagates InvalidRequirementsError from a malformed amount", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ amount: "1.5" })]),
        { maxAmount: 10_000_000n },
        CAIP2_TESTNET,
      ),
    ).toThrow(InvalidRequirementsError);
  });
});

describe("extractRejectionReason", () => {
  it("returns the facilitator's error string", () => {
    const res = new Response("{}", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": b64({ x402Version: 2, error: "over budget", accepts: [] }) },
    });
    expect(extractRejectionReason(res)).toBe("over budget");
  });

  it("returns undefined when absent or unparseable", () => {
    expect(extractRejectionReason(new Response("{}", { status: 402 }))).toBeUndefined();
    expect(
      extractRejectionReason(
        new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": "@@@" } }),
      ),
    ).toBeUndefined();
  });
});

describe("decodeSettlementHeader", () => {
  const withHeader = (name: string, value: string) =>
    new Response("ok", { status: 200, headers: { [name]: value } });

  it("decodes a settled transaction hash", () => {
    const res = withHeader("X-PAYMENT-RESPONSE", b64({ transaction: "abc123", payer: "GPAYER" }));
    expect(decodeSettlementHeader(res)).toEqual({ transaction: "abc123", payer: "GPAYER" });
  });

  it("accepts the PAYMENT-RESPONSE spelling", () => {
    const res = withHeader("PAYMENT-RESPONSE", b64({ transaction: "abc123" }));
    expect(decodeSettlementHeader(res)?.transaction).toBe("abc123");
  });

  it("returns undefined when `transaction` is an empty string", () => {
    const res = withHeader("X-PAYMENT-RESPONSE", b64({ transaction: "", payer: "GPAYER" }));
    expect(decodeSettlementHeader(res)).toBeUndefined();
  });

  it("returns undefined when `transaction` is absent", () => {
    const res = withHeader("X-PAYMENT-RESPONSE", b64({ payer: "GPAYER" }));
    expect(decodeSettlementHeader(res)).toBeUndefined();
  });

  it("returns undefined when the header is missing or unparseable", () => {
    expect(decodeSettlementHeader(new Response("ok", { status: 200 }))).toBeUndefined();
    expect(decodeSettlementHeader(withHeader("X-PAYMENT-RESPONSE", "@@@"))).toBeUndefined();
  });
});
