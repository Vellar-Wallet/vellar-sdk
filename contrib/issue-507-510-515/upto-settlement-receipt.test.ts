import { describe, expect, it } from "vitest";
import {
  buildSettlementReceipt,
  createSessionBudget,
  decodeSettleResult,
  formatSettlementReceiptLines,
  parseSettledAmount,
  resolveSpendDebit,
  SessionCeilingExceededError,
  settlementReceiptFromResponse,
  SettlementNotConfirmedError,
  type SettlementReceipt,
} from "./upto-settlement-receipt";

// proofs.md settlement 3, in base units: 0.05 USDC signed, 0.01 USDC settled.
const CEILING = 50_000n;
const SETTLED = 10_000n;
const TX = "a".repeat(64);

function receipt(over: Partial<Parameters<typeof buildSettlementReceipt>[0]> = {}) {
  return buildSettlementReceipt({
    authorizedCeiling: CEILING,
    reportedSettledAmount: SETTLED.toString(),
    transaction: TX,
    asset: "CCW67TSZ…JMI75",
    network: "stellar:pubnet",
    ...over,
  });
}

/** Base64 of UTF-8 JSON, which is what the wire format actually carries. */
function encodeSettleHeader(settle: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(settle));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** A minimal stand-in for a `Response`, carrying only what the decoder reads. */
function paidResponse(settle: Record<string, unknown> | undefined): {
  headers: { get(name: string): string | null };
} {
  const headers = new Map<string, string>();
  if (settle !== undefined) headers.set("x-payment-response", encodeSettleHeader(settle));
  return { headers: { get: (name) => headers.get(name.toLowerCase()) ?? null } };
}

describe("parseSettledAmount (#510)", () => {
  it("parses a digits-only decimal string at full i128 precision", () => {
    expect(parseSettledAmount("1000")).toBe(1000n);
    // Beyond 2^53, where Number.isInteger(Number(x)) would lose the value.
    const huge = "340282366920938463463374607431768211455";
    expect(parseSettledAmount(huge)).toBe(340282366920938463463374607431768211455n);
  });

  it("accepts an exact integer number, as a JSON body would carry", () => {
    expect(parseSettledAmount(1000)).toBe(1000n);
  });

  it("drops anything that is not an exact non-negative integer", () => {
    // Dropped rather than coerced: a value that fails here must fall back to the
    // authorized ceiling, never become the number charged to a budget.
    for (const bad of ["1e5", "-1", " 1000 ", "1000n", "0x10", "1.5", "", "abc", "1,000"]) {
      expect(parseSettledAmount(bad), bad).toBeUndefined();
    }
    // A float is not an exact base-unit amount, whatever its integer part.
    expect(parseSettledAmount(1.5)).toBeUndefined();
    expect(parseSettledAmount(Number.MAX_SAFE_INTEGER + 2)).toBeUndefined();
  });

  it("treats absent and null as absent, not as zero", () => {
    expect(parseSettledAmount(undefined)).toBeUndefined();
    expect(parseSettledAmount(null)).toBeUndefined();
  });
});

describe("buildSettlementReceipt — the gap is the feature (#510)", () => {
  it("exposes the authorized ceiling AND the settled amount side by side", () => {
    const r = receipt();
    expect(r.authorizedCeiling).toBe(50_000n);
    expect(r.settledAmount).toBe(10_000n);
    expect(r.unusedCeiling).toBe(40_000n);
    expect(r.settledBelowCeiling).toBe(true);
    expect(r.source).toBe("facilitator");
  });

  it("reports a full settle as settledBelowCeiling=false with no gap", () => {
    const r = receipt({ reportedSettledAmount: CEILING.toString() });
    expect(r.settledAmount).toBe(CEILING);
    expect(r.unusedCeiling).toBe(0n);
    expect(r.settledBelowCeiling).toBe(false);
    expect(r.source).toBe("facilitator");
  });

  it("falls back to the ceiling when the facilitator omits the amount", () => {
    // `exact` facilitators may omit it. The signed amount is the only figure
    // justifiable without trusting the server's string.
    for (const omitted of [undefined, null] as const) {
      const r = receipt({ reportedSettledAmount: omitted });
      expect(r.settledAmount).toBe(CEILING);
      expect(r.source).toBe("ceiling-fallback");
    }
  });

  it("falls back to the ceiling when the reported amount is malformed", () => {
    for (const bad of ["", "abc", "-5", "1e3", "0x10"]) {
      const r = receipt({ reportedSettledAmount: bad });
      expect(r.settledAmount, bad).toBe(CEILING);
      expect(r.source, bad).toBe("ceiling-fallback");
    }
  });

  it("clamps a settled figure ABOVE the ceiling and flags it", () => {
    // upto bounds actual_amount <= max_amount ON-CHAIN, so a report above the
    // ceiling is a contract violation, not a bigger bill. It must not be
    // reported as spend, or a facilitator could push a budget past what the
    // buyer ever authorized.
    const r = receipt({ reportedSettledAmount: "999999" });
    expect(r.settledAmount).toBe(CEILING);
    expect(r.source).toBe("ceiling-clamped");
    expect(r.settledBelowCeiling).toBe(false);
  });

  it("refuses a negative authorized ceiling", () => {
    expect(() => receipt({ authorizedCeiling: -1n })).toThrow(RangeError);
  });

  it("keeps payer optional and omits it when absent", () => {
    expect(receipt().payer).toBeUndefined();
    expect(receipt({ payer: "CB…" }).payer).toBe("CB…");
  });
});

describe("settlementReceiptFromResponse (#510)", () => {
  const ctx = { authorizedCeiling: CEILING, asset: "A", network: "stellar:testnet" };

  it("builds a receipt from the facilitator settle header", () => {
    const res = paidResponse({ success: true, transaction: TX, amount: "10000", payer: "CB…" });
    const r = settlementReceiptFromResponse(res, ctx)!;
    expect(r.settledAmount).toBe(10_000n);
    expect(r.authorizedCeiling).toBe(50_000n);
    expect(r.payer).toBe("CB…");
  });

  it("returns undefined when the response carries no settle header", () => {
    // Absent is not the same as settled-for-nothing: the caller has to be able
    // to tell a verify-stage rejection from a clean non-spend.
    expect(settlementReceiptFromResponse(paidResponse(undefined), ctx)).toBeUndefined();
  });

  it("returns undefined for a malformed transaction hash", () => {
    for (const tx of ["", "not-a-hash", "zz".repeat(32), "a".repeat(63), "a".repeat(65)]) {
      expect(settlementReceiptFromResponse(paidResponse({ success: true, transaction: tx }), ctx), tx)
        .toBeUndefined();
    }
  });

  it("returns undefined when fees were charged but the transaction failed", () => {
    // success:false with a NON-empty hash means it was submitted and fees were
    // charged. Not a completed payment, and not evidence of non-spend.
    const r = settlementReceiptFromResponse(
      paidResponse({ success: false, transaction: TX, errorReason: "boom" }),
      ctx,
    );
    expect(r).toBeUndefined();
  });

  it("ignores an unparseable settle header rather than throwing", () => {
    const res = {
      headers: { get: () => "!!!not base64 json!!!" },
    };
    expect(settlementReceiptFromResponse(res, ctx)).toBeUndefined();
    expect(decodeSettleResult(res)).toBeUndefined();
  });

  it("does NOT read the settled amount from the resource body", () => {
    // The body is authored by the payee. Only the facilitator's header, built
    // from the contract's emitted transfer event, is evidence the buyer can
    // trust, so a seller echoing a settlement must not move the debit.
    const res = paidResponse({ success: true, transaction: TX, amount: "10000" });
    (res as { body?: unknown }).body = { settlement: { amount: "1" } };
    expect(settlementReceiptFromResponse(res, ctx)!.settledAmount).toBe(10_000n);
  });
});

describe("createSessionBudget — reserve the ceiling, debit the settled (#510)", () => {
  const ASSET = "CCW67TSZ…JMI75";

  it("charges the session budget the SETTLED amount, not the ceiling", () => {
    // The acceptance criterion: budgets must deplete against real spend.
    const budget = createSessionBudget(new Map([[ASSET, 1_000_000n]]));
    for (let i = 0; i < 10; i++) {
      const r = receipt({ authorizedCeiling: 50_000n, reportedSettledAmount: "10000" });
      budget.reserve(ASSET, r.authorizedCeiling);
      budget.settle(ASSET, r);
    }
    // 10 x 10,000 settled = 100,000. Booking the 50,000 ceiling instead would
    // have left 500,000 and refused a fifth of the calls.
    expect(budget.remainingFor(ASSET)).toBe(900_000n);
    expect(budget.snapshot()[0]!.spent).toBe("100000");
  });

  it("holds the whole ceiling in flight so a concurrent caller is refused", () => {
    const budget = createSessionBudget(new Map([[ASSET, 100_000n]]));
    budget.reserve(ASSET, 60_000n);
    // Only 40,000 is free while 60,000 is held, even though nothing has settled.
    expect(budget.remainingFor(ASSET)).toBe(40_000n);
    expect(() => budget.reserve(ASSET, 50_000n)).toThrow(SessionCeilingExceededError);
    expect(budget.snapshot()[0]!.reserved).toBe("60000");
  });

  it("releases the full ceiling and debits the settled figure on confirm", () => {
    const budget = createSessionBudget(new Map([[ASSET, 100_000n]]));
    const r = receipt({ authorizedCeiling: 50_000n, reportedSettledAmount: "10000" });
    budget.reserve(ASSET, r.authorizedCeiling);
    budget.settle(ASSET, r);
    const row = budget.snapshot()[0]!;
    expect(row.reserved).toBe("0");
    expect(row.spent).toBe("10000");
    expect(row.remaining).toBe("90000");
  });

  it("returns the held ceiling on a cancelled payment", () => {
    const budget = createSessionBudget(new Map([[ASSET, 100_000n]]));
    budget.reserve(ASSET, 50_000n);
    budget.release(ASSET, 50_000n);
    expect(budget.remainingFor(ASSET)).toBe(100_000n);
    expect(budget.snapshot()[0]!.spent).toBe("0");
  });

  it("fails closed on an unconfigured asset rather than treating it as unlimited", () => {
    const budget = createSessionBudget(new Map([[ASSET, 100_000n]]));
    expect(() => budget.reserve("UNKNOWN", 1n)).toThrow(SessionCeilingExceededError);
  });

  it("does not underflow when a caller settles without reserving", () => {
    const budget = createSessionBudget(new Map([[ASSET, 100_000n]]));
    const r = receipt({ authorizedCeiling: 50_000n, reportedSettledAmount: "10000" });
    budget.settle(ASSET, r);
    expect(budget.snapshot()[0]!.reserved).toBe("0");
    expect(budget.remainingFor(ASSET)).toBe(90_000n);
  });

  it("charges the ceiling, not the metered figure, when the amount is malformed", () => {
    const budget = createSessionBudget(new Map([[ASSET, 100_000n]]));
    const r = receipt({ authorizedCeiling: 50_000n, reportedSettledAmount: "garbage" });
    expect(r.source).toBe("ceiling-fallback");
    budget.reserve(ASSET, r.authorizedCeiling);
    budget.settle(ASSET, r);
    expect(budget.snapshot()[0]!.spent).toBe("50000");
  });

  it("notifies on every reservation so a caller can mirror the hold", () => {
    const seen: string[] = [];
    const budget = createSessionBudget(new Map([[ASSET, 100_000n]]), (_a, amount) =>
      seen.push(amount.toString()),
    );
    budget.reserve(ASSET, 50_000n);
    budget.reserve(ASSET, 25_000n);
    expect(seen).toEqual(["50000", "25000"]);
  });
});

describe("resolveSpendDebit (#510)", () => {
  it("debits the settled amount on a confirmed settlement", () => {
    const r = receipt();
    const out = resolveSpendDebit({ kind: "settled", receipt: r }, CEILING);
    expect(out.debit).toBe(10_000n);
    expect(out.basis).toBe("settled");
  });

  it("debits the CEILING when the outcome is indeterminate", () => {
    // Failing closed: the payment may have settled, and a ledger that ignored
    // it would under-count real spend and let the ceiling be exceeded later.
    // Over-counting refuses a legitimate payment; the other direction permits an
    // illegitimate one. (Security audit V-2.)
    const out = resolveSpendDebit({ kind: "indeterminate", reason: "no settle header" }, CEILING);
    expect(out.debit).toBe(50_000n);
    expect(out.basis).toBe("ceiling");
    expect(out.reason).toContain("no settle header");
  });

  it("debits nothing when there is positive evidence nothing was spent", () => {
    const out = resolveSpendDebit({ kind: "not-spent", reason: "failed before submission" }, CEILING);
    expect(out.debit).toBe(0n);
    expect(out.basis).toBe("none");
  });
});

describe("formatSettlementReceiptLines — the CLI pair (#510)", () => {
  it("prints the ceiling and the settled amount side by side, with the gap", () => {
    const lines = formatSettlementReceiptLines(receipt());
    expect(lines[0]).toBe("Authorized: 50000 base units of CCW67TSZ…JMI75");
    expect(lines[1]).toBe("Settled:    10000 base units of CCW67TSZ…JMI75");
    expect(lines[2]).toContain("settled 40000 base units below the authorized ceiling");
  });

  it("says so explicitly when the scheme settled in full", () => {
    const lines = formatSettlementReceiptLines(receipt({ reportedSettledAmount: CEILING.toString() }));
    expect(lines[2]).toBe("            (settled in full)");
  });

  it("labels a fallback rather than implying the ceiling was genuinely charged", () => {
    // A missing measurement is not evidence of a full settle; printing them
    // identically would turn "unknown" into a confident wrong number.
    const lines = formatSettlementReceiptLines(receipt({ reportedSettledAmount: undefined }));
    expect(lines[2]).toContain("reported no settled amount");
    expect(lines[2]).not.toContain("settled in full");
  });

  it("names the clamp when the facilitator reported more than the ceiling", () => {
    const lines = formatSettlementReceiptLines(receipt({ reportedSettledAmount: "999999" }));
    expect(lines[1]).toBe("Settled:    50000 base units of CCW67TSZ…JMI75");
    expect(lines[2]).toContain("clamped down to the ceiling");
  });

  it("always ends with the settlement transaction", () => {
    const lines = formatSettlementReceiptLines(receipt());
    expect(lines.at(-1)).toBe(`Settlement: ${TX}`);
  });

  it("accepts an asset label and omits a trailing payer field cleanly", () => {
    const r: SettlementReceipt = receipt();
    expect(formatSettlementReceiptLines(r, { assetLabel: "USDC" })[0]).toContain("of USDC");
  });
});

describe("exports the not-confirmed error for callers that need it", () => {
  it("is a distinct, catchable type", () => {
    const err = new SettlementNotConfirmedError("no settlement");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SettlementNotConfirmedError");
  });
});
