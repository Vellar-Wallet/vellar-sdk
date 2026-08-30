// Tests for the PURE x402 decision layer. No network, no signer, no stellar-sdk.
// The smart-account client's own wiring is tested in x402-client.test.ts.

import { describe, expect, it } from "vitest";
import {
  base64ToUtf8,
  decodePaymentRequired,
  decodeSettlementHeader,
  extractRejectionReason,
  parseAmount,
  selectRequirements,
  utf8ToBase64,
} from "./x402-guards";
import {
  DisallowedAssetError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
} from "./x402-types";
import { CAIP2_TESTNET, TOKEN, b64, decoded, requirements, response402 } from "./x402-test-fixtures";

const ALLOWED = "CALLOWEDASSET34567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567X";

describe("base64 helpers", () => {
  it("round-trips non-ASCII without Buffer", () => {
    const s = '{"note":"café · 数字 · 🜲"}';
    expect(base64ToUtf8(utf8ToBase64(s))).toBe(s);
  });
});

describe("parseAmount", () => {
  it("parses a digits-only base-unit string", () => {
    expect(parseAmount("1000000")).toBe(1000000n);
  });

  it("preserves precision beyond Number.MAX_SAFE_INTEGER", () => {
    // The official client validates with Number.isInteger(Number(amount)), which
    // silently rounds here. A digits-only test keeps the full i128 range exact.
    expect(parseAmount("9007199254740993")).toBe(9007199254740993n);
  });

  it("rejects exponent notation that Number() would accept", () => {
    expect(() => parseAmount("1e5")).toThrow(InvalidRequirementsError);
  });

  it("parses zero amount input", () => {
    expect(parseAmount("0")).toBe(0n);
  });

  it("rejects negative amount input", () => {
    expect(() => parseAmount("-1")).toThrow(InvalidRequirementsError);
  });

  it.each(["1.5", "abc", "-5", "", " 12 "])("rejects %o", (bad) => {
    expect(() => parseAmount(bad)).toThrow(InvalidRequirementsError);
  });
});

describe("decodePaymentRequired", () => {
  it("decodes the PAYMENT-REQUIRED header", () => {
    const out = decodePaymentRequired(response402([requirements()]));
    expect(out.x402Version).toBe(2);
    expect(out.accepts[0]!.asset).toBe(TOKEN);
  });

  it("reads a lowercase header name", () => {
    const res = new Response("{}", {
      status: 402,
      headers: { "payment-required": b64({ x402Version: 2, accepts: [requirements()] }) },
    });
    expect(decodePaymentRequired(res).accepts).toHaveLength(1);
  });

  it("throws on a 402 with no PAYMENT-REQUIRED header", () => {
    expect(() => decodePaymentRequired(new Response("{}", { status: 402 }))).toThrow(
      NoUsablePaymentOptionError,
    );
  });

  it("throws on a malformed PAYMENT-REQUIRED header", () => {
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

  // ── fee sponsorship must be stated explicitly ──────────────────────────────
  // The official ExactStellarScheme dereferences `extra.areFeesSponsored` with
  // no null check, and its own validator never inspects `extra` — so an option
  // missing `extra` entirely reaches it and throws a raw TypeError. We refuse
  // it here instead, with a typed error.

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

  // This is the ~1-in-3 testnet settle failure. NOTHING is spent, so it must
  // read as "not settled" — never as a completed payment.
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
