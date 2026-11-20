import { describe, it, expect } from "vitest";
import {
  classifySettlementFailure,
  isRetrySafeSettlementFailure,
  SettlementFailureReason,
  SettlementFailure,
  SettlementTransactionSubmissionFailedError,
  SettlementTransactionFailedError,
  FeeExceedsMaximumError,
  SponsorBalanceLowError,
  SpendControlRefusalError,
} from "./x402-guards.js";

/**
 * All documented settlement failure reason codes.
 * Each entry pairs a reason code with a factory that builds a representative
 * typed error for that reason, plus the transaction field value used.
 */
const documentedFailureCases: Array<{
  reason: SettlementFailureReason;
  makeError: (transaction: string) => SettlementFailure;
}> = [
  {
    reason: "settle_exact_stellar_transaction_submission_failed",
    makeError: (transaction) =>
      new SettlementTransactionSubmissionFailedError({ transaction }),
  },
  {
    reason: "settle_exact_stellar_transaction_failed",
    makeError: (transaction) =>
      new SettlementTransactionFailedError({ transaction }),
  },
  {
    reason: "fee_exceeds_maximum",
    makeError: (transaction) => new FeeExceedsMaximumError({ transaction }),
  },
  {
    reason: "sponsor_balance_low",
    makeError: (transaction) => new SponsorBalanceLowError({ transaction }),
  },
  {
    reason: "spend_control_refusal",
    makeError: (transaction) => new SpendControlRefusalError({ transaction }),
  },
];

describe("classifySettlementFailure", () => {
  describe("happy path: empty transaction field is retry-safe", () => {
    it.each(documentedFailureCases)(
      "classifies $reason with empty transaction as retry-safe",
      ({ reason, makeError }) => {
        const error = makeError("");
        const result = classifySettlementFailure(error);

        expect(result.reason).toBe(reason);
        expect(result.retrySafe).toBe(true);
        expect(result.transaction).toBe("");
      },
    );

    it("treats a missing transaction field as retry-safe", () => {
      const error = new SettlementTransactionFailedError({});
      const result = classifySettlementFailure(error);

      expect(result.retrySafe).toBe(true);
      expect(result.transaction).toBeUndefined();
    });
  });

  describe("failure mode: non-empty transaction field is never retry-safe", () => {
    it.each(documentedFailureCases)(
      "classifies $reason with non-empty transaction as never-retry",
      ({ reason, makeError }) => {
        const error = makeError("deadbeef");
        const result = classifySettlementFailure(error);

        expect(result.reason).toBe(reason);
        expect(result.retrySafe).toBe(false);
        expect(result.transaction).toBe("deadbeef");
      },
    );

    it("treats a whitespace-only transaction field as non-empty (never-retry)", () => {
      const error = new SettlementTransactionSubmissionFailedError({
        transaction: "   ",
      });
      const result = classifySettlementFailure(error);

      expect(result.retrySafe).toBe(false);
    });
  });

  describe("transaction field is inspected before the reason code", () => {
    it("returns never-retry for a reason that is otherwise retry-safe when transaction is set", () => {
      // fee_exceeds_maximum is retry-safe by default, but a non-empty
      // transaction field must override that and force never-retry.
      const error = new FeeExceedsMaximumError({ transaction: "abc123" });
      const result = classifySettlementFailure(error);

      expect(result.reason).toBe("fee_exceeds_maximum");
      expect(result.retrySafe).toBe(false);
    });

    it("returns retry-safe for a reason that is otherwise never-retry when transaction is empty", () => {
      // spend_control_refusal is never-retry by default, but an empty
      // transaction field must override that and force retry-safe.
      const error = new SpendControlRefusalError({ transaction: "" });
      const result = classifySettlementFailure(error);

      expect(result.reason).toBe("spend_control_refusal");
      expect(result.retrySafe).toBe(true);
    });
  });
});

describe("classifySettlementFailure vs per-error-type retry flags", () => {
  it.each(documentedFailureCases)(
    "never disagrees for $reason with empty transaction",
    ({ reason, makeError }) => {
      const error = makeError("");
      const classified = classifySettlementFailure(error);
      const perTypeRetrySafe = isRetrySafeSettlementFailure(error);

      expect(classified.reason).toBe(reason);
      expect(classified.retrySafe).toBe(perTypeRetrySafe);
    },
  );

  it.each(documentedFailureCases)(
    "never disagrees for $reason with non-empty transaction",
    ({ reason, makeError }) => {
      const error = makeError("tx-hash");
      const classified = classifySettlementFailure(error);
      const perTypeRetrySafe = isRetrySafeSettlementFailure(error);

      expect(classified.reason).toBe(reason);
      expect(classified.retrySafe).toBe(perTypeRetrySafe);
    },
  );

  it("covers every documented failure reason code", () => {
    const coveredReasons = new Set(documentedFailureCases.map((c) => c.reason));
    const allReasons: SettlementFailureReason[] = [
      "settle_exact_stellar_transaction_submission_failed",
      "settle_exact_stellar_transaction_failed",
      "fee_exceeds_maximum",
      "sponsor_balance_low",
      "spend_control_refusal",
    ];

    for (const reason of allReasons) {
      expect(coveredReasons.has(reason)).toBe(true);
    }
  });
});