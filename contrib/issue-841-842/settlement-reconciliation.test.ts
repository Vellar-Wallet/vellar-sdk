import { describe, it, expect, vi } from "vitest";
import {
  handleSettlementFailure,
  reconcileSettlement,
  RECONCILIATION_GUIDANCE,
} from "./settlement-reconciliation";
import {
  classifySettlementFailure,
  SETTLEMENT_FAILURE_REASONS,
  SettlementFailureError,
  SettlementTransactionFailedError,
} from "../../src/x402-guards";

const HASH = "a".repeat(64);

const failedWithHash = {
  success: false,
  errorReason: "settle_exact_stellar_transaction_failed",
  transaction: HASH,
  network: "stellar:testnet",
};

// #842 — the unambiguous, documented case: non-empty transaction, Horizon
// confirms successful: false.
describe("non-empty transaction, Horizon successful: false (#842)", () => {
  it("surfaces the typed never-retry error with the transaction hash attached", async () => {
    const lookup = vi.fn().mockResolvedValue({ successful: false });

    const result = await reconcileSettlement(failedWithHash, lookup);

    expect(result.state).toBe("confirmed-failed");
    if (result.state !== "confirmed-failed") throw new Error("unreachable");
    expect(result.error).toBeInstanceOf(SettlementTransactionFailedError);
    expect(result.error).toBeInstanceOf(SettlementFailureError);
    expect(result.error.transaction).toBe(HASH);
    expect(result.error.retryable).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.transaction).toBe(HASH);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(HASH);
  });

  it("does not attempt any automatic retry", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const lookup = vi.fn().mockResolvedValue({ successful: false });

    const { reconciliation, retried } = await handleSettlementFailure(failedWithHash, { lookup, retry });

    expect(reconciliation.state).toBe("confirmed-failed");
    expect(retried).toBe(false);
    expect(retry).not.toHaveBeenCalled();
  });

  it("is the baseline: the SDK classifier already calls it terminal", () => {
    expect(classifySettlementFailure(failedWithHash).retryable).toBe(false);
  });
});

// #841 — the ambiguous case: a failure reason alongside a non-empty
// transaction, but Horizon shows successful: true.
describe("non-empty transaction, Horizon successful: true (#841)", () => {
  it("surfaces reconciliation-needed, trusting neither the failure nor a naive success", async () => {
    const lookup = vi.fn().mockResolvedValue({ successful: true });

    const result = await reconcileSettlement(failedWithHash, lookup);

    expect(result.state).toBe("reconciliation-needed");
    if (result.state !== "reconciliation-needed") throw new Error("unreachable");
    expect(result.transaction).toBe(HASH);
    expect(result.facilitatorReason).toBe("settle_exact_stellar_transaction_failed");
    expect(result.retryable).toBe(false);
    // Not the confirmed-failure error, and not a success.
    expect("error" in result).toBe(false);
  });

  it("tells the caller to use Horizon as the tiebreaker and not to retry", async () => {
    const result = await reconcileSettlement(failedWithHash, async () => ({ successful: true }));

    if (result.state !== "reconciliation-needed") throw new Error("unreachable");
    expect(result.guidance).toBe(RECONCILIATION_GUIDANCE);
    expect(result.guidance).toMatch(/Horizon/);
    expect(result.guidance).toMatch(/Do NOT retry/);
  });

  it("does not attempt any automatic retry", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);

    const { reconciliation, retried } = await handleSettlementFailure(failedWithHash, {
      lookup: async () => ({ successful: true }),
      retry,
    });

    expect(reconciliation.state).toBe("reconciliation-needed");
    expect(retried).toBe(false);
    expect(retry).not.toHaveBeenCalled();
  });

  it("stays consistent with the never-retry guard for every documented reason code", async () => {
    for (const errorReason of Object.keys(SETTLEMENT_FAILURE_REASONS)) {
      const settle = { success: false, errorReason, transaction: HASH };

      // The SDK guard: a non-empty transaction is never retried.
      expect(classifySettlementFailure(settle).retryable).toBe(false);

      // And reconciliation agrees whichever way Horizon answers.
      for (const successful of [true, false]) {
        const result = await reconcileSettlement(settle, async () => ({ successful }));
        expect(result.retryable).toBe(false);
      }
    }
  });
});

describe("when Horizon cannot confirm", () => {
  it("reports unverified (and still never retries) if the transaction is not found", async () => {
    const result = await reconcileSettlement(failedWithHash, async () => undefined);

    expect(result.state).toBe("unverified");
    expect(result.retryable).toBe(false);
  });

  it("reports unverified instead of throwing when the lookup rejects", async () => {
    const result = await reconcileSettlement(failedWithHash, async () => {
      throw new Error("Horizon 503");
    });

    expect(result.state).toBe("unverified");
    if (result.state !== "unverified") throw new Error("unreachable");
    expect(result.reason).toBe("Horizon 503");
  });
});

describe("empty or absent transaction keeps the SDK rule", () => {
  it("is retry-safe and retries exactly once, without asking Horizon", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const lookup = vi.fn();
    const settle = {
      success: false,
      errorReason: "settle_exact_stellar_transaction_submission_failed",
      transaction: "",
    };

    const { reconciliation, retried } = await handleSettlementFailure(settle, { lookup, retry });

    expect(reconciliation.state).toBe("not-submitted");
    expect(retried).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not retry a missing settle result", async () => {
    const retry = vi.fn();
    const { reconciliation, retried } = await handleSettlementFailure(undefined, {
      lookup: vi.fn(),
      retry,
    });

    expect(reconciliation.state).toBe("no-failure-reported");
    expect(retried).toBe(false);
    expect(retry).not.toHaveBeenCalled();
  });

  it("does not look anything up for a settlement that reported no failure", async () => {
    const lookup = vi.fn();
    const result = await reconcileSettlement({ success: true, transaction: HASH }, lookup);

    expect(result.state).toBe("no-failure-reported");
    expect(lookup).not.toHaveBeenCalled();
  });
});
