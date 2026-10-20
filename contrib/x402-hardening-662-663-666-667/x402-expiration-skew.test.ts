// Issue #667 — clock-skew tolerance for x402 expiration.
//
// Expiration is a LEDGER number read from the RPC (src/x402-client.ts
// `expirationOffsetFor`), never derived from the local wall clock, so a client
// clock seconds ahead of or behind the facilitator's cannot shift it. The
// tolerance is the safety margin: we sign EXPIRATION_SAFETY_MARGIN (2 ledgers,
// ~10s at 5s ledgers) inside the facilitator's window, and never fewer than
// MIN_EXPIRATION_LEDGERS (3, the V-13 floor). The constants are not exported
// from src/, so they are restated here and pinned through observable behaviour.

import { afterEach, describe, expect, it } from "vitest";
import { expirationOffsetFor } from "../../src/x402-client.js";

const LEDGER_SECONDS = 5;
const SAFETY_MARGIN = 2;
const MIN_LEDGERS = 3;

const realNow = Date.now;
afterEach(() => {
  Date.now = realNow;
});

describe("expiration — clock-skew tolerance", () => {
  it.each([-30_000, -5_000, 5_000, 30_000])(
    "is unchanged by a local clock skewed %i ms",
    (skewMs) => {
      const baseline = expirationOffsetFor(120);
      Date.now = () => realNow() + skewMs;
      expect(expirationOffsetFor(120)).toBe(baseline);
    },
  );

  it("signs the documented margin (2 ledgers ≈ 10s) inside the server window", () => {
    expect(Math.ceil(120 / LEDGER_SECONDS) - expirationOffsetFor(120)).toBe(SAFETY_MARGIN);
    expect(SAFETY_MARGIN * LEDGER_SECONDS).toBeGreaterThanOrEqual(10);
  });

  it("never signs below the V-13 floor, however tight the server window", () => {
    expect(expirationOffsetFor(0)).toBe(MIN_LEDGERS);
    expect(expirationOffsetFor(5)).toBe(MIN_LEDGERS);
    expect(expirationOffsetFor(20)).toBe(MIN_LEDGERS);
  });

  it("honours an explicit ceiling without dropping under the floor", () => {
    expect(expirationOffsetFor(120, 10)).toBe(10);
    expect(expirationOffsetFor(120, 1)).toBe(MIN_LEDGERS);
  });
});
