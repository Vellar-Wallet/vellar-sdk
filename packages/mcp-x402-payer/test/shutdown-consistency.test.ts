import { describe, expect, it } from "vitest";
import { createMutex, createSpendLedger } from "../src/ledger.js";
import { ASSET_A, ASSET_B, testConfig } from "./helpers.js";

describe("shutdown during payment - ledger consistency", () => {
  it("ledger ends in consistent state when shutdown occurs mid-payment", async () => {
    const config = testConfig();
    const ledger = createSpendLedger(config.ceilings);
    const mutex = createMutex(ledger);

    // Simulate a payment with multiple steps (like a real payment flow)
    const paymentSteps: string[] = [];

    const simulatedPayment = mutex(async () => {
      paymentSteps.push("start");

      // Step 1: Check ceiling
      ledger.assertWithinCeiling(ASSET_A, 500n);
      paymentSteps.push("checked_ceiling");

      // Step 2: Simulate payment processing delay (like network request)
      await new Promise((resolve) => setTimeout(resolve, 30));
      paymentSteps.push("payment_processed");

      // Step 3: Record the payment
      ledger.record(ASSET_A, 500n);
      paymentSteps.push("recorded");
    });

    // Start the payment
    const paymentPromise = simulatedPayment;

    // Initiate shutdown quickly, but after the payment has started
    await new Promise((resolve) => setTimeout(resolve, 5));
    const shutdownPromise = ledger.shutdown();

    // Wait for both to complete
    await Promise.all([paymentPromise, shutdownPromise]);

    // Verify the payment completed fully
    expect(paymentSteps).toEqual([
      "start",
      "checked_ceiling",
      "payment_processed",
      "recorded",
    ]);

    // Verify ledger is consistent
    const remaining = ledger.remainingFor(ASSET_A);
    expect(remaining).toBe(0n); // Should have exactly 1M - 500k = 500k remaining

    const snapshot = ledger.snapshot();
    const assetA = snapshot.find((s) => s.asset === ASSET_A);
    expect(assetA?.spent).toBe("500000");
    expect(assetA?.remaining).toBe("500000");
  });

  it("no partial ledger updates - either full payment is recorded or nothing", async () => {
    const config = testConfig();
    const ledger = createSpendLedger(config.ceilings);
    const mutex = createMutex(ledger);

    const events: string[] = [];

    // Payment that checks but fails to record (simulates network error)
    const failingPayment = mutex(async () => {
      events.push("payment_start");
      ledger.assertWithinCeiling(ASSET_A, 600n);
      events.push("ceiling_checked");
      // Simulate network failure before recording
      throw new Error("Network error during settlement");
    });

    // Start payment
    const paymentPromise = failingPayment.catch(() => {
      // Expected to fail
    });

    // Initiate shutdown
    const shutdownPromise = ledger.shutdown();

    await Promise.all([paymentPromise, shutdownPromise]);

    // Verify payment was never recorded (ledger remains unchanged)
    const remaining = ledger.remainingFor(ASSET_A);
    expect(remaining).toBe(1000000n); // Full ceiling still available

    const snapshot = ledger.snapshot();
    const assetA = snapshot.find((s) => s.asset === ASSET_A);
    expect(assetA?.spent).toBe("0");
  });

  it("multiple concurrent payments complete before shutdown resolves", async () => {
    const config = testConfig();
    const ledger = createSpendLedger(config.ceilings);
    const mutex = createMutex(ledger);

    const completedPayments: number[] = [];

    // Start 3 concurrent payments with different amounts
    const payments = [
      mutex(async () => {
        ledger.assertWithinCeiling(ASSET_A, 300000n);
        await new Promise((resolve) => setTimeout(resolve, 20));
        ledger.record(ASSET_A, 300000n);
        completedPayments.push(1);
      }),
      mutex(async () => {
        ledger.assertWithinCeiling(ASSET_A, 400000n);
        await new Promise((resolve) => setTimeout(resolve, 30));
        ledger.record(ASSET_A, 400000n);
        completedPayments.push(2);
      }),
      mutex(async () => {
        ledger.assertWithinCeiling(ASSET_A, 300000n);
        await new Promise((resolve) => setTimeout(resolve, 10));
        ledger.record(ASSET_A, 300000n);
        completedPayments.push(3);
      }),
    ];

    // Give all payments time to start
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Initiate shutdown
    const shutdownPromise = ledger.shutdown();

    // Wait for everything
    await Promise.all([...payments, shutdownPromise]);

    // All payments should have completed
    expect(completedPayments.sort((a, b) => a - b)).toEqual([1, 2, 3]);

    // Ledger should reflect all payments
    const remaining = ledger.remainingFor(ASSET_A);
    expect(remaining).toBe(0n); // 1M - (300k + 400k + 300k)

    const snapshot = ledger.snapshot();
    const assetA = snapshot.find((s) => s.asset === ASSET_A);
    expect(assetA?.spent).toBe("1000000");
    expect(assetA?.remaining).toBe("0");
  });

  it("prevents new payments while existing ones are in-flight", async () => {
    const config = testConfig();
    const ledger = createSpendLedger(config.ceilings);
    const mutex = createMutex(ledger);

    const events: string[] = [];

    // Start a long-running payment
    const slowPayment = mutex(async () => {
      events.push("payment1_start");
      ledger.assertWithinCeiling(ASSET_A, 500n);
      await new Promise((resolve) => setTimeout(resolve, 50));
      ledger.record(ASSET_A, 500n);
      events.push("payment1_end");
    });

    // Give the first payment time to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now initiate shutdown
    const shutdownPromise = ledger.shutdown();

    // Try to queue a new payment after shutdown
    const newPaymentAttempt = mutex(async () => {
      events.push("payment2_start"); // Should not reach here
      ledger.assertWithinCeiling(ASSET_A, 300n);
    });

    // The new payment should fail
    await expect(newPaymentAttempt).rejects.toThrow(/shutting down/i);

    // But shutdown should wait for the first payment
    await Promise.all([slowPayment, shutdownPromise]);

    // First payment should have completed fully
    expect(events).toContain("payment1_start");
    expect(events).toContain("payment1_end");

    // Second payment should never have started
    expect(events).not.toContain("payment2_start");

    // Ledger should reflect only the first payment
    const snapshot = ledger.snapshot();
    const assetA = snapshot.find((s) => s.asset === ASSET_A);
    expect(assetA?.spent).toBe("500");
  });

  it("handles cross-asset payments correctly during shutdown", async () => {
    const config = testConfig();
    const ledger = createSpendLedger(config.ceilings);
    const mutex = createMutex(ledger);

    // Payment on asset A
    await mutex(async () => {
      ledger.assertWithinCeiling(ASSET_A, 500000n);
      ledger.record(ASSET_A, 500000n);
    });

    // Payment on asset B
    await mutex(async () => {
      ledger.assertWithinCeiling(ASSET_B, 250n);
      ledger.record(ASSET_B, 250n);
    });

    // Initiate shutdown
    await ledger.shutdown();

    // Verify both assets are correctly recorded
    const snapshot = ledger.snapshot();

    const assetA = snapshot.find((s) => s.asset === ASSET_A);
    expect(assetA?.spent).toBe("500000");
    expect(assetA?.remaining).toBe("500000");

    const assetB = snapshot.find((s) => s.asset === ASSET_B);
    expect(assetB?.spent).toBe("250");
    expect(assetB?.remaining).toBe("250");
  });

  it("ceiling checks remain enforced until shutdown completes", async () => {
    const config = testConfig();
    const ledger = createSpendLedger(config.ceilings);
    const mutex = createMutex(ledger);

    // Record a large payment
    await mutex(async () => {
      ledger.assertWithinCeiling(ASSET_A, 900000n);
      ledger.record(ASSET_A, 900000n);
    });

    // Verify only 100k remaining
    expect(ledger.remainingFor(ASSET_A)).toBe(100000n);

    // Start shutdown
    await ledger.shutdown();

    // New payment attempts should be rejected by shutdown, not ceiling
    expect(() => ledger.assertWithinCeiling(ASSET_A, 50000n)).toThrow(
      /shutting down/i,
    );
  });

  it("snapshot consistency before and after shutdown", async () => {
    const config = testConfig();
    const ledger = createSpendLedger(config.ceilings);
    const mutex = createMutex(ledger);

    // Make some payments
    await mutex(async () => {
      ledger.assertWithinCeiling(ASSET_A, 700000n);
      ledger.record(ASSET_A, 700000n);
    });

    await mutex(async () => {
      ledger.assertWithinCeiling(ASSET_B, 100n);
      ledger.record(ASSET_B, 100n);
    });

    const snapBefore = ledger.snapshot();

    // Initiate shutdown
    await ledger.shutdown();

    const snapAfter = ledger.snapshot();

    // Snapshots should be identical
    expect(snapAfter).toEqual(snapBefore);

    // Verify exact values
    expect(snapAfter).toEqual([
      {
        asset: ASSET_A,
        spent: "700000",
        ceiling: "1000000",
        remaining: "300000",
      },
      {
        asset: ASSET_B,
        spent: "100",
        ceiling: "500",
        remaining: "400",
      },
    ]);
  });

  it("indeterminate payments during shutdown are still debited", async () => {
    const config = testConfig();
    const ledger = createSpendLedger(config.ceilings);
    const mutex = createMutex(ledger);

    let paymentDebited = false;

    // Simulate an indeterminate settlement that debits the ledger
    const indeterminatePayment = mutex(async () => {
      ledger.assertWithinCeiling(ASSET_A, 600000n);
      // Simulate recording the payment as if it was indeterminate
      ledger.record(ASSET_A, 600000n);
      paymentDebited = true;
    });

    // Start shutdown
    const shutdownPromise = ledger.shutdown();

    // Wait for completion
    await Promise.all([indeterminatePayment, shutdownPromise]);

    // Payment should have been debited
    expect(paymentDebited).toBe(true);

    const remaining = ledger.remainingFor(ASSET_A);
    expect(remaining).toBe(400000n);
  });
});
