// Surface the ceiling-versus-settled gap for `upto` payments (#510).
//
// The point of `upto` is that the buyer signs a CEILING and the chain moves only
// the METERED amount. `website/content/docs/reference/proofs.md` settlement 3 is
// the canonical example: a 0.05 USDC ceiling with 0.01 USDC actually settled.
// That gap is the feature, but nothing in the buyer result surfaces it, so a
// caller cannot learn "you authorized X, you were charged Y" without decoding
// the facilitator's settle header themselves.
//
// Three places in the tree collapse the pair, and each is a different kind of
// wrong:
//
//   1. `src/x402-types.ts` — `X402Settlement` carries a single `amount`, which
//      `src/x402-client.ts` fills with the SIGNED amount. The metered figure is
//      not parsed anywhere on this base: `SettleResult` has no `amount` field
//      and `classifySettlement` does not read one, so the SDK never has the
//      number it would need.
//   2. `src/x402-client.ts` — the budget is debited at `amount`, the ceiling.
//      Under `upto` that over-charges the budget by the unused ceiling on every
//      call, so a budget depletes against authorizations rather than spend. The
//      MCP payer's `SpendLedger` has the same shape: `record(asset, amount)` and
//      no reservation, so nothing distinguishes an in-flight payment from a
//      settled one.
//   3. `packages/cli/src/commands/pay.ts` — prints the transaction and nothing
//      else. When it is extended to the pair, the obvious place to read the
//      settled amount from is the seller's JSON body, and that field is chosen
//      by the party being paid. The facilitator's `X-PAYMENT-RESPONSE` header is
//      the only settlement evidence the buyer can trust.
//
// This module is the receipt all three need: one object that pairs the
// authorized ceiling with what actually settled, and a budget that reserves the
// ceiling in flight but is debited the settled amount on confirmation.
//
// Four invariants, each load-bearing:
//
//   - The settled amount is read ONLY from the facilitator's settle header. A
//     seller-supplied field is never a source. Debiting a budget from a number
//     the payee chose would let a payee under-report its own charge to keep a
//     buyer's session alive, or over-report it to exhaust one.
//   - A malformed settled amount is DROPPED in favour of the ceiling, never
//     coerced. Charging the ceiling can only refuse a payment that would
//     otherwise have been allowed; parsing garbage into a number would let a
//     server-supplied string set the debit.
//   - A settled amount ABOVE the ceiling is CLAMPED and flagged. `upto` enforces
//     `actual_amount <= max_amount` ON-CHAIN (`website/content/docs/concepts/
//     upto-scheme.md`), so a report above the ceiling is a contract-bound
//     violation, not a bigger bill. Reporting it as spend would let a
//     misbehaving facilitator push a buyer's budget past the amount the buyer
//     ever authorized.
//   - An absent settle header yields NO receipt, not a zero-amount one. A missing
//     header is a verify-stage rejection, which a caller must be able to
//     distinguish from a payment that settled for nothing.
//
// Pure and dependency-free: no Node builtins, no stellar-sdk, no DOM globals
// beyond `Response`/`atob`, which the guards module already relies on. Usable
// today as a standalone wrapper around `decodeSettleResponseHeader` from
// `vellar-sdk/x402-guards`.

/** A base-unit amount string: digits only, no sign, no exponent, no whitespace. */
const DIGITS_ONLY = /^\d+$/;

/** A Stellar transaction hash: 32 bytes, hex. Mirrors `src/x402-guards.ts`. */
const TRANSACTION_HASH = /^[0-9a-f]{64}$/i;

/**
 * Where the receipt's settled figure came from.
 *
 * Exposed rather than collapsed, because the three cases have different
 * consequences and a caller auditing a session needs to know which one it is
 * looking at before it trusts the number as a measurement.
 */
export type SettledAmountSource =
  /** The facilitator reported a well-formed figure at or below the ceiling. */
  | "facilitator"
  /** Absent or malformed; the signed ceiling is charged instead. */
  | "ceiling-fallback"
  /** Reported above the ceiling — an on-chain bound violation; clamped down. */
  | "ceiling-clamped";

/** The raw, untrusted settlement fields a receipt is built from. */
export interface SettlementReceiptInput {
  /**
   * The ceiling the buyer signed and authorized, in the asset's base units.
   *
   * For `exact` this equals the settled amount by construction. For `upto` it is
   * the upper bound the payer agreed to, and the chain may move less.
   */
  authorizedCeiling: bigint;
  /**
   * What the facilitator reported as settled, as a decimal string. Untrusted
   * input: validated, never trusted. See the module comment.
   */
  reportedSettledAmount?: string | undefined;
  transaction: string;
  payer?: string | undefined;
  asset: string;
  network: string;
}

/**
 * A completed payment, with both halves of the `upto` gap attached.
 *
 * A receipt that reports only one of the two figures cannot be audited: a cheap
 * metered call and an expensive ceiling the buyer got away with look identical
 * if you only keep the charge, and identical if you only keep the ceiling. Both
 * are always present, so the caller never has to reconstruct either.
 */
export interface SettlementReceipt {
  /** The ceiling the buyer signed. What they authorized. */
  authorizedCeiling: bigint;
  /** What the chain actually moved. What they were charged. */
  settledAmount: bigint;
  /** `authorizedCeiling - settledAmount`. Zero for `exact`. */
  unusedCeiling: bigint;
  /** True when the settled figure came back below the authorized ceiling. */
  settledBelowCeiling: boolean;
  /** Provenance of {@link settledAmount}. */
  source: SettledAmountSource;
  transaction: string;
  payer?: string;
  asset: string;
  network: string;
}

/** A receipt that is safe to render but not to charge: the payment did not settle. */
export class SettlementNotConfirmedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementNotConfirmedError";
  }
}

/**
 * Validate a base-unit amount string.
 *
 * Digits only. The official client's own validator uses
 * `Number.isInteger(Number(amount))`, which accepts `"1e5"` and silently loses
 * precision above 2^53; `src/x402-guards.ts` deliberately tightened this to a
 * digits-only test to keep the full i128 range exact, and the same rule applies
 * to the settled figure.
 *
 * Returns `undefined` rather than throwing: a malformed value is a reason to
 * fall back to the ceiling, not to abort a payment that has already settled.
 */
export function parseSettledAmount(raw: string | number | undefined | null): bigint | undefined {
  if (raw === undefined || raw === null) return undefined;
  // A JSON body can carry a number where the wire format specifies a string.
  // Accepting an exact integer is safe; anything else (a float, an exponent, a
  // negative) fails the digits test below and is dropped.
  const text = typeof raw === "number" ? (Number.isSafeInteger(raw) ? String(raw) : "") : raw;
  if (!DIGITS_ONLY.test(text)) return undefined;
  return BigInt(text);
}

/**
 * Build a receipt, applying the three invariants.
 *
 * Pure, so the whole policy is testable without a chain, a facilitator, or a
 * network — which is the point: the ceiling/settled decision is money, and money
 * logic that can only be exercised against a live facilitator gets exercised
 * roughly never.
 */
export function buildSettlementReceipt(input: SettlementReceiptInput): SettlementReceipt {
  const ceiling = input.authorizedCeiling;
  if (ceiling < 0n) {
    throw new RangeError(`authorizedCeiling must be non-negative, got ${ceiling}`);
  }

  const reported = parseSettledAmount(input.reportedSettledAmount);

  let settledAmount: bigint;
  let source: SettledAmountSource;
  if (reported === undefined) {
    // Absent or malformed. Charge the ceiling: that is the amount the buyer
    // authorized, so it is the only figure we can justify without trusting the
    // server's string.
    settledAmount = ceiling;
    source = "ceiling-fallback";
  } else if (reported > ceiling) {
    // The chain bounds `actual_amount <= max_amount` itself, so a figure above
    // the ceiling cannot be a legitimate larger bill. Clamp, and say so.
    settledAmount = ceiling;
    source = "ceiling-clamped";
  } else {
    settledAmount = reported;
    source = "facilitator";
  }

  const receipt: SettlementReceipt = {
    authorizedCeiling: ceiling,
    settledAmount,
    unusedCeiling: ceiling - settledAmount,
    settledBelowCeiling: settledAmount < ceiling,
    source,
    transaction: input.transaction,
    asset: input.asset,
    network: input.network,
    ...(input.payer !== undefined ? { payer: input.payer } : {}),
  };
  return receipt;
}

/**
 * The facilitator's settle result, as carried on the paid response.
 *
 * Structurally identical to `SettleResult` in `src/x402-guards.ts`; restated
 * here so this module stays usable without a runtime import from `src/`.
 */
export interface FacilitatorSettleResult {
  success?: boolean;
  transaction?: string;
  payer?: string;
  errorReason?: string;
  network?: string;
  /** What actually settled, as a decimal string. */
  amount?: string;
}

/** Decode the facilitator's settle header, or `undefined` when absent. */
export function decodeSettleResult(res: {
  headers: { get(name: string): string | null };
}): FacilitatorSettleResult | undefined {
  const header =
    res.headers.get("X-PAYMENT-RESPONSE") ??
    res.headers.get("PAYMENT-RESPONSE") ??
    res.headers.get("x-payment-response");
  if (!header) return undefined;
  try {
    return JSON.parse(decodeBase64Utf8(header)) as FacilitatorSettleResult;
  } catch {
    return undefined;
  }
}

/**
 * Build a receipt from a paid response, or `undefined` when the payment did not
 * settle.
 *
 * The settled amount comes from the header and nowhere else. It is tempting to
 * also accept a settlement echoed in the resource body, and the CLI does exactly
 * that today — but the body is authored by the payee, so accepting it means
 * letting the party being paid choose what the buyer is told it spent. The
 * header is set by the facilitator from the contract's emitted transfer event,
 * which is the only figure the buyer cannot be lied to about.
 *
 * Returns `undefined` for a response carrying no usable settlement, rather than
 * throwing: an absent settle header is a verify-stage rejection, which the
 * caller must distinguish from a settle that moved nothing. `classifySettlement`
 * in `src/x402-guards.ts` is the canonical implementation of that distinction;
 * this function is the narrow "give me a receipt or nothing" wrapper over it.
 */
export function settlementReceiptFromResponse(
  res: { headers: { get(name: string): string | null } },
  context: { authorizedCeiling: bigint; asset: string; network: string },
): SettlementReceipt | undefined {
  const settle = decodeSettleResult(res);
  if (!settle) return undefined;

  const tx = settle.transaction ?? "";
  if (!TRANSACTION_HASH.test(tx)) return undefined;
  // `success: false` with a non-empty hash means it was submitted and fees were
  // charged even though the transaction then failed. That is not a completed
  // payment, but it is not a clean non-spend either, so no receipt is issued
  // and the caller must fall back to its indeterminate path.
  if (settle.success === false) return undefined;

  return buildSettlementReceipt({
    authorizedCeiling: context.authorizedCeiling,
    reportedSettledAmount: settle.amount,
    transaction: tx,
    payer: settle.payer,
    asset: context.asset,
    network: context.network,
  });
}

function decodeBase64Utf8(value: string): string {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  // Node without a DOM global. Kept dependency-free rather than importing
  // `node:buffer`, so this module stays usable in a browser bundle.
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let bits = "";
  for (const ch of value.replace(/=+$/, "")) {
    const index = B64.indexOf(ch);
    if (index < 0) throw new Error("not base64");
    bits += index.toString(2).padStart(6, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// ── session budget ────────────────────────────────────────────────────────────

/** Per-asset budget state, as reported to a caller. */
export interface BudgetSnapshotRow {
  asset: string;
  spent: string;
  reserved: string;
  ceiling: string;
  remaining: string;
}

/** An asset with no configured ceiling. Thrown rather than treated as unlimited. */
export class SessionCeilingExceededError extends Error {
  constructor(
    readonly asset: string,
    readonly requested: bigint,
    readonly alreadyCommitted: bigint,
    readonly ceiling: bigint,
  ) {
    super(
      `session budget for ${asset}: requested ${requested}, already committed ${alreadyCommitted}, ceiling ${ceiling}.`,
    );
    this.name = "SessionCeilingExceededError";
  }
}

/**
 * A session budget that RESERVES the ceiling and DEBITS the settled amount.
 *
 * The asymmetry is the whole mechanism. Between signing and settlement the true
 * charge is unknown — it could be anywhere up to the ceiling — so the ceiling is
 * held in full, which is the pessimistic and safe direction: a second caller
 * arriving mid-payment sees the reservation and is refused rather than both
 * passing a check-then-record test. Once the chain reports what it moved, the
 * reservation is dropped and only the metered figure is deducted.
 *
 * Booking the ceiling on settlement instead would make an `upto` budget
 * deplete at the rate of authorizations rather than spend, which for a
 * metered-calling agent is the difference between a session that lasts the
 * task and one that stops after the first call. That is the bug #510 names.
 */
export interface SessionBudget {
  /** Hold the full ceiling for an in-flight payment. Throws if it does not fit. */
  reserve(asset: string, authorizedCeiling: bigint): void;
  /**
   * Confirm a payment: drop the reservation, debit the receipt's settled amount.
   * `receipt` is required, not the two amounts separately, so the figure charged
   * can never diverge from the figure reported.
   */
  settle(asset: string, receipt: SettlementReceipt): void;
  /** Release a reservation: the payment failed or was cancelled, nothing moved. */
  release(asset: string, authorizedCeiling: bigint): void;
  remainingFor(asset: string): bigint;
  snapshot(): BudgetSnapshotRow[];
}

/** Build a session budget over per-asset ceilings. */
export function createSessionBudget(
  ceilings: ReadonlyMap<string, bigint>,
  onReserve?: (asset: string, amount: bigint) => void,
): SessionBudget {
  const spent = new Map<string, bigint>();
  const reserved = new Map<string, bigint>();

  function ceilingFor(asset: string): bigint {
    const ceiling = ceilings.get(asset);
    if (ceiling === undefined) {
      // Not a configured asset means not payable. Fails closed: an unconfigured
      // asset treated as unlimited would be an unbounded debit.
      throw new SessionCeilingExceededError(asset, 0n, 0n, 0n);
    }
    return ceiling;
  }
  const spentFor = (asset: string) => spent.get(asset) ?? 0n;
  const reservedFor = (asset: string) => reserved.get(asset) ?? 0n;

  function dropReservation(asset: string, authorizedCeiling: bigint): void {
    // Floored at 0: a caller that bypassed `reserve` must not drive the counter
    // negative and hand out budget that does not exist.
    const current = reservedFor(asset);
    reserved.set(asset, current >= authorizedCeiling ? current - authorizedCeiling : 0n);
  }

  return {
    reserve(asset, authorizedCeiling) {
      const ceiling = ceilingFor(asset);
      const committed = spentFor(asset) + reservedFor(asset);
      if (committed + authorizedCeiling > ceiling) {
        throw new SessionCeilingExceededError(asset, authorizedCeiling, committed, ceiling);
      }
      reserved.set(asset, reservedFor(asset) + authorizedCeiling);
      onReserve?.(asset, authorizedCeiling);
    },

    settle(asset, receipt) {
      ceilingFor(asset);
      dropReservation(asset, receipt.authorizedCeiling);
      // The DEBIT is the receipt's settled amount — never its ceiling. This is
      // the single line the issue turns on.
      spent.set(asset, spentFor(asset) + receipt.settledAmount);
    },

    release(asset, authorizedCeiling) {
      ceilingFor(asset);
      dropReservation(asset, authorizedCeiling);
    },

    remainingFor(asset) {
      const remaining = ceilingFor(asset) - (spentFor(asset) + reservedFor(asset));
      return remaining > 0n ? remaining : 0n;
    },

    snapshot() {
      return [...ceilings.entries()].map(([asset, ceiling]) => {
        const s = spentFor(asset);
        const r = reservedFor(asset);
        const remaining = ceiling - (s + r);
        return {
          asset,
          spent: s.toString(),
          reserved: r.toString(),
          ceiling: ceiling.toString(),
          remaining: (remaining > 0n ? remaining : 0n).toString(),
        };
      });
    },
  };
}

/**
 * How much budget a payment actually costs, given what is known about it.
 *
 * Split out because it is the decision the SDK's own budget record gets wrong
 * today, and it is worth stating as a rule rather than as a call site:
 *
 * - `settled`  → debit the settled amount. A confirmed hash and a metered
 *   figure; the number is a measurement.
 * - `indeterminate` → debit the CEILING. The payment may have succeeded, and a
 *   ledger that ignored it would under-count real spend and let the ceiling be
 *   exceeded later. Over-counting refuses a legitimate payment; the other
 *   direction permits an illegitimate one. (Security audit V-2.)
 * - `not-spent` → debit nothing. There is positive evidence nothing reached the
 *   chain: the facilitator released its fee reservation.
 */
export type SpendOutcome =
  | { kind: "settled"; receipt: SettlementReceipt }
  | { kind: "indeterminate"; reason: string }
  | { kind: "not-spent"; reason: string };

/** The amount to debit a budget for, given what is known about the payment. */
export function resolveSpendDebit(
  outcome: SpendOutcome,
  authorizedCeiling: bigint,
): { debit: bigint; basis: "settled" | "ceiling" | "none"; reason: string } {
  if (outcome.kind === "settled") {
    return {
      debit: outcome.receipt.settledAmount,
      basis: "settled",
      reason: `confirmed settlement debited the metered amount, not the ceiling`,
    };
  }
  if (outcome.kind === "indeterminate") {
    return {
      debit: authorizedCeiling,
      basis: "ceiling",
      reason: `no confirmed settled figure, so the authorized ceiling is debited: ${outcome.reason}`,
    };
  }
  return { debit: 0n, basis: "none", reason: outcome.reason };
}

// ── rendering ─────────────────────────────────────────────────────────────────

/**
 * Render a receipt as the pair of lines a human reads.
 *
 * Both figures are always printed, side by side, and the relationship between
 * them is stated rather than left to be inferred. For the `exact` scheme the
 * two are equal by construction and the output says so, instead of leaving the
 * reader to assume; under `upto` the gap is named with its size.
 *
 * The fallback case is labelled too. A receipt whose settled figure came from
 * the ceiling because the facilitator omitted it is NOT evidence that the
 * ceiling was charged in full, and printing it identically to a real full
 * settle would turn a missing measurement into a confident wrong number.
 */
export function formatSettlementReceiptLines(
  receipt: SettlementReceipt,
  options: { assetLabel?: string } = {},
): string[] {
  const label = options.assetLabel ?? receipt.asset;
  const lines = [
    `Authorized: ${receipt.authorizedCeiling} base units of ${label}`,
    `Settled:    ${receipt.settledAmount} base units of ${label}`,
  ];

  if (receipt.source === "ceiling-fallback") {
    lines.push(
      "            (the facilitator reported no settled amount; the authorized ceiling is shown as the charge)",
    );
  } else if (receipt.source === "ceiling-clamped") {
    lines.push(
      `            (the facilitator reported more than the authorized ceiling, which ` +
        `${receipt.asset} bounds on-chain; the figure was clamped down to the ceiling)`,
    );
  } else if (receipt.settledBelowCeiling) {
    lines.push(
      `            (settled ${receipt.unusedCeiling} base units below the authorized ceiling)`,
    );
  } else {
    lines.push("            (settled in full)");
  }

  lines.push(`Settlement: ${receipt.transaction}`);
  return lines;
}
