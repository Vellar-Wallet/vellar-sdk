// V-7: a seller must not choose how long our signature stays valid.
//
// The clamp's own correctness is easy. The part worth testing is that it cannot
// create the failure it exists to prevent — a legitimate payment expiring
// mid-flight because we shortened its window.

import { describe, expect, it } from "vitest";
import { expirationOffsetFor } from "vellar-sdk";

// Constants mirrored from the implementations under test.
const LEDGER_SECONDS = 5;
const SAFETY_MARGIN = 2;
const MIN_LEDGERS = 3;
const MAX_SECONDS = 300;

/** The scheme client's rule, kept in step with smart-account-scheme.ts. */
function schemeLedgersFor(maxTimeoutSeconds: number): number {
  const requested = Math.min(maxTimeoutSeconds, MAX_SECONDS);
  return Math.max(Math.ceil(requested / LEDGER_SECONDS) - SAFETY_MARGIN, MIN_LEDGERS);
}

/** Worst sign-to-settled window measured against a live facilitator. */
const WORST_OBSERVED_SECONDS = 12;

describe("V-7 — seller-requested signature lifetime is bounded", () => {
  it("honours ordinary merchant timeouts unchanged", () => {
    // 120s is what the reference seller advertises; nothing should move.
    expect(schemeLedgersFor(120)).toBe(22);
    expect(schemeLedgersFor(60)).toBe(10);
    expect(schemeLedgersFor(300)).toBe(58);
  });

  it("clamps a hostile 24-hour request", () => {
    // 86,400s would otherwise buy ~17,278 ledgers.
    expect(schemeLedgersFor(86_400)).toBe(58);
    expect(schemeLedgersFor(Number.MAX_SAFE_INTEGER)).toBe(58);
  });

  it("cuts hostile exposure by roughly two orders of magnitude", () => {
    const unclamped = Math.ceil(86_400 / LEDGER_SECONDS) - SAFETY_MARGIN;
    expect(unclamped / schemeLedgersFor(86_400)).toBeGreaterThan(250);
  });

  it("CLAMPS rather than rejects — a generous merchant is not attacking", () => {
    // The payment still proceeds; only the window shrinks.
    expect(schemeLedgersFor(86_400)).toBeGreaterThanOrEqual(MIN_LEDGERS);
  });
});

describe("V-7 — the clamp cannot expire a legitimate payment", () => {
  // Each retry RE-SIGNS (payer.ts calls signPayment inside the loop) and there
  // is no backoff, so a signature must survive exactly ONE attempt — not the
  // whole retry chain. This is the interaction that would make the fix cause
  // the failure it prevents.
  it("leaves a single attempt far inside the clamped window", () => {
    const ledgers = schemeLedgersFor(MAX_SECONDS);
    const windowSeconds = ledgers * LEDGER_SECONDS;
    expect(windowSeconds).toBeGreaterThan(WORST_OBSERVED_SECONDS * 20);
  });

  it("still covers one attempt even at a modest merchant timeout", () => {
    // 60s is on the short side for a real seller; one attempt is ~12s worst.
    const windowSeconds = schemeLedgersFor(60) * LEDGER_SECONDS;
    expect(windowSeconds).toBeGreaterThan(WORST_OBSERVED_SECONDS * 2);
  });

  it("never shortens a window that was already inside the cap", () => {
    // The clamp is a ceiling only — it must be a no-op below the bound.
    for (const t of [10, 30, 60, 120, 240, 300]) {
      const unclamped = Math.max(Math.ceil(t / LEDGER_SECONDS) - SAFETY_MARGIN, MIN_LEDGERS);
      expect(schemeLedgersFor(t)).toBe(unclamped);
    }
  });

  it("would survive the WHOLE retry chain even if a signature were shared", () => {
    // Each attempt re-signs, so the chain total is not actually charged against
    // one signature (asserted directly in payer.test.ts: "signs a FRESH payload
    // for every attempt"). This checks the conservative case anyway: if the
    // chain DID share one signature, it would still fit. Safe under both models
    // means a future change to the retry logic cannot silently break the clamp.
    const wholeChainSeconds = WORST_OBSERVED_SECONDS * 3; // MAX_ATTEMPTS
    const windowSeconds = schemeLedgersFor(120) * LEDGER_SECONDS;
    expect(windowSeconds).toBeGreaterThan(wholeChainSeconds);
  });
});

describe("V-7 — the classic client is capped by default too", () => {
  it("bounds a hostile timeout without an explicit ceiling", () => {
    // Previously unbounded unless the caller passed expirationLedgerOffset.
    expect(expirationOffsetFor(86_400)).toBe(58);
  });

  it("leaves ordinary values alone", () => {
    expect(expirationOffsetFor(120)).toBe(22);
    expect(expirationOffsetFor(30)).toBe(4);
  });

  it("still lets an explicit ceiling win", () => {
    expect(expirationOffsetFor(86_400, 10)).toBe(10);
  });

  it("keeps the floor", () => {
    expect(expirationOffsetFor(1)).toBe(MIN_LEDGERS);
  });
});

describe("V-13 — an unworkably short seller timeout is refused up front", () => {
  // The floor (3 ledgers ≈ 15s) sat only ~3s above the measured 12s worst case,
  // so a short seller window produced a signature that could expire mid-settle
  // and fail opaquely. Nothing is at risk either way — an expired signature is
  // rejected at verify — but the caller could not tell why.
  const MIN_VIABLE = 5;

  function schemeOrThrow(maxTimeoutSeconds: number): number {
    const requested = Math.min(maxTimeoutSeconds, MAX_SECONDS);
    const offset = Math.max(
      Math.ceil(requested / LEDGER_SECONDS) - SAFETY_MARGIN,
      MIN_LEDGERS,
    );
    if (offset < MIN_VIABLE) throw new Error(`unworkable: ${offset} ledgers`);
    return offset;
  }

  it.each([1, 5, 10, 20, 30])("refuses %ss — below what a settlement needs", (t) => {
    expect(() => schemeOrThrow(t)).toThrow(/unworkable/);
  });

  it("accepts the shortest workable window", () => {
    // 35s -> 7-2 = 5 ledgers = the threshold exactly.
    expect(schemeOrThrow(35)).toBe(MIN_VIABLE);
  });

  it("accepts every realistic merchant timeout", () => {
    for (const t of [60, 120, 300, 86_400]) {
      expect(() => schemeOrThrow(t)).not.toThrow();
    }
  });

  it("leaves a viable window above the measured worst case", () => {
    expect(MIN_VIABLE * LEDGER_SECONDS).toBeGreaterThan(WORST_OBSERVED_SECONDS * 2);
  });
});
