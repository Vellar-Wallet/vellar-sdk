import { describe, expect, it, beforeEach } from "vitest";
import { createMutex, createSpendLedger } from "../src/ledger.js";
import { ASSET_A, ASSET_B, testConfig } from "./helpers.js";

describe("graceful shutdown", () => {
  describe("ledger shutdown tracking", () => {
    it("reports not shutting down initially", () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      expect(ledger.isShuttingDown()).toBe(false);
    });

    it("blocks new payments after shutdown is initiated", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);

      // Initiate shutdown
      const shutdownPromise = ledger.shutdown();

      // New payment should be rejected
      expect(() => ledger.assertWithinCeiling(ASSET_A, 100n)).toThrow(
        /shutting down/i,
      );

      await shutdownPromise;
    });

    it("allows in-flight payments to complete before shutdown resolves", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      const mutex = createMutex(ledger);

      let paymentFinished = false;

      // Start an in-flight payment
      const paymentPromise = mutex(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        paymentFinished = true;
      });

      // Initiate shutdown immediately (before the payment finishes)
      const shutdownPromise = ledger.shutdown();

      // Give shutdown a moment to try to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Shutdown should still be pending because the payment is in-flight
      expect(paymentFinished).toBe(false);

      // Wait for both to complete
      await paymentPromise;
      await shutdownPromise;

      // Now the payment should be finished
      expect(paymentFinished).toBe(true);
    });

    it("resolves immediately if no in-flight payments", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);

      const start = Date.now();
      await ledger.shutdown();
      const elapsed = Date.now() - start;

      // Should complete nearly instantly (no in-flight sections)
      expect(elapsed).toBeLessThan(50);
    });

    it("blocks shutdown until all in-flight critical sections complete", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      const mutex = createMutex(ledger);

      const completionOrder: string[] = [];

      // Start multiple concurrent in-flight payments
      const payment1 = mutex(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        completionOrder.push("payment1");
      });

      const payment2 = mutex(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        completionOrder.push("payment2");
      });

      // Give both payments a moment to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Initiate shutdown
      const shutdownPromise = ledger.shutdown();

      // Shutdown should wait for all payments
      await Promise.all([payment1, payment2, shutdownPromise]);

      // Both payments should have completed
      expect(completionOrder).toContain("payment1");
      expect(completionOrder).toContain("payment2");
    });

    it("accepts only one shutdown call and reuses the same promise", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);

      const shutdown1 = ledger.shutdown();
      const shutdown2 = ledger.shutdown();

      // Both should be the same promise
      expect(shutdown1).toBe(shutdown2);

      await shutdown1;
    });
  });

  describe("mutex with ledger tracking", () => {
    it("tracks critical section lifecycle", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      const mutex = createMutex(ledger);

      let sectionActive = false;

      const task = mutex(async () => {
        sectionActive = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        sectionActive = false;
      });

      // Give the task a moment to start
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Ledger should know a section is in flight
      expect(sectionActive).toBe(true);

      // Shutdown should block while section is active
      let shutdownResolved = false;
      const shutdownPromise = ledger.shutdown();
      shutdownPromise.then(() => {
        shutdownResolved = true;
      });

      // Give shutdown a moment to block
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(shutdownResolved).toBe(false);

      // Wait for task to finish
      await task;

      // Now shutdown should resolve
      await shutdownPromise;
      expect(shutdownResolved).toBe(true);
    });

    it("keeps chain alive even if a critical section throws", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      const mutex = createMutex(ledger);

      let secondTaskRan = false;

      await expect(
        mutex(async () => {
          throw new Error("section error");
        }),
      ).rejects.toThrow("section error");

      // Next task should still run (chain not poisoned)
      await mutex(async () => {
        secondTaskRan = true;
      });

      expect(secondTaskRan).toBe(true);
    });

    it("still allows shutdown even if a critical section throws", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      const mutex = createMutex(ledger);

      const failingTask = mutex(async () => {
        throw new Error("payment failed");
      });

      // Initiate shutdown
      const shutdownPromise = ledger.shutdown();

      // Both should complete without hanging
      await expect(failingTask).rejects.toThrow("payment failed");
      await shutdownPromise;
    });
  });

  describe("ledger state during shutdown", () => {
    it("prevents new ceiling checks after shutdown", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);

      await ledger.shutdown();

      // Should throw immediately
      expect(() => ledger.assertWithinCeiling(ASSET_A, 100n)).toThrow(
        /shutting down/i,
      );
    });

    it("allows recording an in-flight payment that completed before shutdown resolved", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      const mutex = createMutex(ledger);

      let recordingSucceeded = false;

      const payment = mutex(async () => {
        ledger.assertWithinCeiling(ASSET_A, 1000n);
        ledger.record(ASSET_A, 1000n);
        recordingSucceeded = true;
      });

      // Start shutdown immediately
      const shutdownPromise = ledger.shutdown();

      // Wait for both
      await Promise.all([payment, shutdownPromise]);

      expect(recordingSucceeded).toBe(true);
      expect(ledger.remainingFor(ASSET_A)).toBe(0n);
    });

    it("maintains ledger consistency with multiple concurrent payments before shutdown", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      const mutex = createMutex(ledger);

      // Start 3 concurrent payments
      const payments = [
        mutex(async () => {
          ledger.assertWithinCeiling(ASSET_A, 300n);
          await new Promise((resolve) => setTimeout(resolve, 10));
          ledger.record(ASSET_A, 300n);
        }),
        mutex(async () => {
          ledger.assertWithinCeiling(ASSET_A, 400n);
          await new Promise((resolve) => setTimeout(resolve, 15));
          ledger.record(ASSET_A, 400n);
        }),
        mutex(async () => {
          ledger.assertWithinCeiling(ASSET_A, 300n);
          await new Promise((resolve) => setTimeout(resolve, 5));
          ledger.record(ASSET_A, 300n);
        }),
      ];

      // Initiate shutdown
      const shutdownPromise = ledger.shutdown();

      // All should complete
      await Promise.all([...payments, shutdownPromise]);

      // Ledger should reflect all transactions
      const snapshot = ledger.snapshot();
      const assetA = snapshot.find((s) => s.asset === ASSET_A);
      expect(assetA?.spent).toBe("1000");
      expect(assetA?.remaining).toBe("0");
    });
  });

  describe("shutdown with no ledger tracking", () => {
    it("works without a ledger (backward compatibility)", async () => {
      const mutex = createMutex();

      let taskRan = false;
      await mutex(async () => {
        taskRan = true;
      });

      expect(taskRan).toBe(true);
    });

    it("serializes tasks without ledger", async () => {
      const mutex = createMutex();
      const events: string[] = [];

      await Promise.all([
        mutex(async () => {
          events.push("a:start");
          await new Promise((resolve) => setTimeout(resolve, 5));
          events.push("a:end");
        }),
        mutex(async () => {
          events.push("b:start");
          await new Promise((resolve) => setTimeout(resolve, 5));
          events.push("b:end");
        }),
      ]);

      // Should still be serialized even without ledger
      expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
    });
  });

  describe("edge cases and race conditions", () => {
    it("handles shutdown called while critical section is starting", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      const mutex = createMutex(ledger);

      const taskStarted = new Promise<void>((resolve) => {
        mutex(async () => {
          resolve();
          await new Promise((r) => setTimeout(r, 20));
        });
      });

      // Wait for task to actually start
      await taskStarted;

      // Then immediately shut down
      await ledger.shutdown();

      expect(ledger.isShuttingDown()).toBe(true);
    });

    it("rejects new payments queued after shutdown initiated", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      const mutex = createMutex(ledger);

      const inFlightPayment = mutex(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      // Start shutdown
      const shutdownPromise = ledger.shutdown();

      // Try to queue a new payment after shutdown
      const newPaymentAttempt = mutex(async () => {
        ledger.assertWithinCeiling(ASSET_A, 100n);
      });

      // The new payment should fail
      await expect(newPaymentAttempt).rejects.toThrow(/shutting down/i);

      // But the in-flight one should still complete
      await inFlightPayment;
      await shutdownPromise;
    });

    it("snapshot remains consistent after shutdown", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      const mutex = createMutex(ledger);

      await mutex(async () => {
        ledger.assertWithinCeiling(ASSET_A, 500n);
        ledger.record(ASSET_A, 500n);
      });

      const snapBefore = ledger.snapshot();

      await ledger.shutdown();

      const snapAfter = ledger.snapshot();

      // Snapshot should be identical after shutdown
      expect(snapAfter).toEqual(snapBefore);
      expect(snapAfter[0]?.spent).toBe("500");
    });

    it("shutdown waits for all in-flight even with rapid shutdown calls", async () => {
      const config = testConfig();
      const ledger = createSpendLedger(config.ceilings);
      const mutex = createMutex(ledger);

      let paymentCompleted = false;

      const payment = mutex(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        paymentCompleted = true;
      });

      // Rapid fire shutdown calls
      const [s1, s2, s3] = await Promise.all([
        ledger.shutdown(),
        ledger.shutdown(),
        ledger.shutdown(),
      ]);

      // All should have completed, and payment should be done
      expect(paymentCompleted).toBe(true);
    });
  });
});
