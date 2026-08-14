// Errors specific to the MCP payer. The guard-layer errors (MaxAmountExceeded,
// DisallowedAsset, NoUsablePaymentOption, InvalidRequirements, PaymentRejected)
// come from vellar-sdk/x402-guards and are re-exported here so a caller has one
// import site for everything this server can throw.

export {
  DisallowedAssetError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
  PaymentRejectedError,
} from "vellar-sdk/x402-guards";

/** Startup configuration was missing or malformed. Never carries secret material. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * The cumulative per-session ceiling for this asset would be exceeded.
 *
 * This is the layer the SERVER owns (the model supplies only `max_amount`). It
 * is a guard against mistakes and runaway loops — NOT a security boundary. A
 * compromised agent is bounded by the on-chain budget, not by this.
 */
export class SessionCeilingExceededError extends Error {
  constructor(
    readonly asset: string,
    readonly attempted: bigint,
    readonly spent: bigint,
    readonly ceiling: bigint,
  ) {
    super(
      `x402 payment of ${attempted} would exceed this session's ceiling for asset ${asset}: ` +
        `${spent} already spent of ${ceiling}. Refusing to sign.`,
    );
    this.name = "SessionCeilingExceededError";
  }
}

/**
 * Every attempt came back without a settlement transaction.
 *
 * Roughly one testnet settlement in three returns an empty `transaction` with
 * NOTHING spent, so this is only raised after the bounded retries are exhausted.
 * No funds moved on any attempt that produced this error.
 */
export class SettlementFailedError extends Error {
  constructor(
    readonly attempts: number,
    readonly lastReason?: string,
  ) {
    super(
      `x402 settlement did not complete after ${attempts} attempt(s)` +
        `${lastReason ? `: ${lastReason}` : ""}. ` +
        `No transaction hash was returned, which means nothing was spent.`,
    );
    this.name = "SettlementFailedError";
  }
}

/**
 * The official client selected a payment option other than the one the guards
 * cleared. Raised by the `onBeforePaymentCreation` tripwire — should be
 * unreachable while we narrow `accepts` to a single cleared option, and exists
 * so an upstream change can never silently widen what gets paid.
 */
export class SelectionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionMismatchError";
  }
}

/**
 * The payment MAY have succeeded and we cannot tell.
 *
 * Raised when the settlement is unreadable — a malformed transaction hash, or a
 * 2xx carrying no settle information. Deliberately NOT retried: retrying an
 * indeterminate settlement risks paying twice, which is worse than the
 * uncertainty it would resolve.
 *
 * The session ledger IS debited in this state. If the payment did settle, a
 * ledger that ignored it would under-count real spend and allow the ceiling to
 * be exceeded later; over-counting merely refuses a legitimate payment. Given
 * layer 1 is a guard against mistakes, it must err toward refusing.
 */
export class IndeterminateSettlementError extends Error {
  constructor(
    readonly reason: string,
    readonly asset: string,
    readonly amount: bigint,
    readonly rawTransaction?: string,
  ) {
    super(
      `The payment may have completed, but this could not be confirmed: ${reason}. ` +
        `It was NOT retried, because retrying could pay a second time. ` +
        `${amount} base units of ${asset} have been counted against this session's ceiling ` +
        `as a precaution.` +
        (rawTransaction
          ? ` The server reported "${rawTransaction}", which is not a valid transaction hash — ` +
            `check the payer account on-chain before paying again.`
          : ` Check the payer account on-chain before paying again.`),
    );
    this.name = "IndeterminateSettlementError";
  }
}
