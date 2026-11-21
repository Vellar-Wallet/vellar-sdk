/**
 * Reconcile a settlement failure that carries a transaction hash against
 * Horizon (#841, #842).
 *
 * The SDK's rule (`classifySettlementFailure` in `src/x402-guards.ts`): an
 * EMPTY `transaction` field means nothing reached the chain and a freshly
 * signed retry is safe; a NON-EMPTY one means the payment was submitted and
 * fees were charged, so it is NEVER retried. This module covers the two
 * sub-cases of the non-empty branch, using Horizon as the tiebreaker (the same
 * "verify against the chain, do not trust a single status report" stance the
 * fee-account verification takes):
 *
 *  - Horizon says `successful: false` (#842) — the documented, unambiguous
 *    case. The failure is real. Surfaces the typed
 *    `SettlementTransactionFailedError` with the hash attached, never retries.
 *  - Horizon says `successful: true` (#841) — the facilitator reported a
 *    failure but the chain succeeded (its status reporting lags). Trusting the
 *    failure reason could make a caller treat a settled payment as unpaid, and
 *    assuming success blindly could hide a real problem, so this is surfaced as
 *    a distinct `reconciliation-needed` state. It is also never retried: the
 *    money may already have moved.
 *
 * It never retries on its own account. The only path that calls `retry` is the
 * empty-`transaction` case, and only when `classifySettlementFailure` says so.
 */

import {
  classifySettlementFailure,
  SettlementTransactionFailedError,
  type SettleResult,
} from "../../src/x402-guards";

/** The slice of a Horizon transaction record this module needs. */
export interface HorizonTransactionRecord {
  successful: boolean;
}

/**
 * Look up a transaction on Horizon. Resolve `undefined` (or reject) when it is
 * not found or Horizon is unreachable; that is reported as `unverified`.
 */
export type HorizonTransactionLookup = (
  hash: string,
) => Promise<HorizonTransactionRecord | undefined>;

export type SettlementReconciliation =
  /** Empty `transaction`: nothing was submitted. Defers to `classifySettlementFailure`. */
  | { state: "not-submitted"; retryable: boolean; reason: string }
  /** Non-empty `transaction`, Horizon confirms `successful: false` (#842). */
  | {
      state: "confirmed-failed";
      retryable: false;
      transaction: string;
      error: SettlementTransactionFailedError;
      guidance: string;
    }
  /** Non-empty `transaction`, Horizon says `successful: true` (#841). */
  | {
      state: "reconciliation-needed";
      retryable: false;
      transaction: string;
      /** The failure reason the facilitator reported, if it sent one. */
      facilitatorReason?: string;
      guidance: string;
    }
  /** Non-empty `transaction`, but Horizon could not confirm either way. */
  | {
      state: "unverified";
      retryable: false;
      transaction: string;
      reason: string;
      guidance: string;
    }
  /** The settle result did not report a failure at all. */
  | { state: "no-failure-reported"; retryable: false; reason: string };

/** Caller guidance for the inconsistent #841 case. */
export const RECONCILIATION_GUIDANCE =
  "The facilitator reported a failure but Horizon shows this transaction succeeded. Do NOT retry (the payment may already have moved) and do NOT assume it failed. Treat Horizon as the source of truth: fetch the transaction directly, check it matches the expected payment, then reconcile your records.";

/**
 * Reconcile a settle result against Horizon. Never throws and never retries.
 */
export async function reconcileSettlement(
  settle: SettleResult | undefined,
  lookup: HorizonTransactionLookup,
): Promise<SettlementReconciliation> {
  const classification = classifySettlementFailure(settle);

  const transaction = settle?.transaction;
  if (!transaction) {
    // Empty/absent transaction: the SDK rule decides, unchanged.
    if (settle?.success === false) {
      return {
        state: "not-submitted",
        retryable: classification.retryable,
        reason: classification.reason,
      };
    }
    return {
      state: "no-failure-reported",
      retryable: false,
      reason: classification.reason,
    };
  }

  const reported = settle.success === false || settle.errorReason !== undefined;
  if (!reported) {
    return {
      state: "no-failure-reported",
      retryable: false,
      reason: "the settlement carried a transaction hash and reported no failure",
    };
  }

  let record: HorizonTransactionRecord | undefined;
  try {
    record = await lookup(transaction);
  } catch (error) {
    return unverified(transaction, error instanceof Error ? error.message : String(error));
  }
  if (!record) {
    return unverified(transaction, "Horizon has no record of this transaction");
  }

  if (record.successful === false) {
    return {
      state: "confirmed-failed",
      retryable: false,
      transaction,
      error: new SettlementTransactionFailedError(transaction),
      guidance: `Horizon confirms transaction ${transaction} failed on-chain and fees were charged. Do not retry automatically: investigate with the hash.`,
    };
  }

  return {
    state: "reconciliation-needed",
    retryable: false,
    transaction,
    ...(settle.errorReason !== undefined ? { facilitatorReason: settle.errorReason } : {}),
    guidance: RECONCILIATION_GUIDANCE,
  };
}

function unverified(transaction: string, reason: string): SettlementReconciliation {
  return {
    state: "unverified",
    retryable: false,
    transaction,
    reason,
    guidance: `Could not confirm transaction ${transaction} on Horizon (${reason}). Do not retry: check Horizon directly before deciding.`,
  };
}

export interface HandleSettlementFailureDeps {
  lookup: HorizonTransactionLookup;
  /** Re-sign and resubmit. Only ever invoked for a retry-safe, empty-`transaction` failure. */
  retry?: () => Promise<void>;
}

/**
 * Reconcile and, only when the SDK rule says it is safe, retry once.
 * `retried` shows whether `retry` was called.
 */
export async function handleSettlementFailure(
  settle: SettleResult | undefined,
  deps: HandleSettlementFailureDeps,
): Promise<{ reconciliation: SettlementReconciliation; retried: boolean }> {
  const reconciliation = await reconcileSettlement(settle, deps.lookup);
  if (reconciliation.state === "not-submitted" && reconciliation.retryable && deps.retry) {
    await deps.retry();
    return { reconciliation, retried: true };
  }
  return { reconciliation, retried: false };
}
