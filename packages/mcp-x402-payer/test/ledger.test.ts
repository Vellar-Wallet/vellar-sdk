import { describe, expect, it } from "vitest";
import { SessionCeilingExceededError } from "../src/errors.js";
import { createMutex, createSpendLedger } from "../src/ledger.js";
import { ASSET_A, ASSET_B } from "./helpers.js";

const ceilings = new Map<string, bigint>([
  [ASSET_A, 1000n],
  [ASSET_B, 50n],
]);

describe("spend ledger", () => {
  it("allows spend up to and including the ceiling", () => {
    const ledger = createSpendLedger(ceilings);
    expect(() => ledger.assertWithinCeiling(ASSET_A, 1000n)).not.toThrow();
    ledger.record(ASSET_A, 1000n);
    expect(ledger.remainingFor(ASSET_A)).toBe(0n);
  });

  it("refuses spend that would cross the ceiling", () => {
    const ledger = createSpendLedger(ceilings);
    ledger.record(ASSET_A, 900n);
    expect(() => ledger.assertWithinCeiling(ASSET_A, 101n)).toThrow(SessionCeilingExceededError);
    expect(() => ledger.assertWithinCeiling(ASSET_A, 100n)).not.toThrow();
  });

  it("FAILS CLOSED for an asset with no configured ceiling", () => {
    // An unconfigured asset must never read as unlimited.
    const ledger = createSpendLedger(ceilings);
    expect(() => ledger.assertWithinCeiling("CUNCONFIGURED", 1n)).toThrow(
      SessionCeilingExceededError,
    );
    expect(() => ledger.record("CUNCONFIGURED", 1n)).toThrow(SessionCeilingExceededError);
    expect(() => ledger.remainingFor("CUNCONFIGURED")).toThrow(SessionCeilingExceededError);
  });

  it("tracks each asset independently — no cross-asset total", () => {
    // Base units are not comparable across assets; a shared total would fail
    // OPEN on a cheaply-denominated one.
    const ledger = createSpendLedger(ceilings);
    ledger.record(ASSET_A, 1000n);
    expect(ledger.remainingFor(ASSET_A)).toBe(0n);
    expect(ledger.remainingFor(ASSET_B)).toBe(50n);
    expect(() => ledger.assertWithinCeiling(ASSET_B, 50n)).not.toThrow();
  });

  it("never reports negative remaining", () => {
    const ledger = createSpendLedger(ceilings);
    ledger.record(ASSET_A, 900n);
    ledger.record(ASSET_A, 900n); // direct over-record; remaining floors at 0
    expect(ledger.remainingFor(ASSET_A)).toBe(0n);
  });

  it("snapshots every configured asset, including untouched ones", () => {
    const ledger = createSpendLedger(ceilings);
    ledger.record(ASSET_A, 250n);
    const snap = ledger.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap.find((s) => s.asset === ASSET_A)).toEqual({
      asset: ASSET_A,
      spent: "250",
      ceiling: "1000",
      remaining: "750",
    });
    expect(snap.find((s) => s.asset === ASSET_B)?.spent).toBe("0");
  });

  it("carries the numbers that explain the refusal", () => {
    const ledger = createSpendLedger(ceilings);
    ledger.record(ASSET_A, 800n);
    try {
      ledger.assertWithinCeiling(ASSET_A, 300n);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as SessionCeilingExceededError;
      expect(e.asset).toBe(ASSET_A);
      expect(e.attempted).toBe(300n);
      expect(e.spent).toBe(800n);
      expect(e.ceiling).toBe(1000n);
    }
  });
});

describe("mutex", () => {
  it("serialises overlapping critical sections", async () => {
    // Without this, two concurrent payments could each pass the ceiling check
    // before either recorded, and together exceed it.
    const exclusive = createMutex();
    const events: string[] = [];

    const task = (name: string) =>
      exclusive(async () => {
        events.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, 5));
        events.push(`${name}:end`);
      });

    await Promise.all([task("a"), task("b"), task("c")]);

    expect(events).toEqual([
      "a:start",
      "a:end",
      "b:start",
      "b:end",
      "c:start",
      "c:end",
    ]);
  });

  it("keeps running after a section throws", async () => {
    const exclusive = createMutex();
    await expect(
      exclusive(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The chain must not be poisoned by the failure.
    await expect(exclusive(async () => "ok")).resolves.toBe("ok");
  });

  it("prevents a concurrent check-then-act from busting the ceiling", async () => {
    const ledger = createSpendLedger(new Map([[ASSET_A, 100n]]));
    const exclusive = createMutex();

    const spend = (amount: bigint) =>
      exclusive(async () => {
        ledger.assertWithinCeiling(ASSET_A, amount);
        await new Promise((r) => setTimeout(r, 1)); // the window a race would exploit
        ledger.record(ASSET_A, amount);
      });

    const results = await Promise.allSettled([spend(60n), spend(60n)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(ledger.remainingFor(ASSET_A)).toBe(40n);
  });
});
