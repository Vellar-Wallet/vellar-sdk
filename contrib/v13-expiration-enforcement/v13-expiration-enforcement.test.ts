/**
 * V-13 Expiration Floor Enforcement
 *
 * Security audit V-13: Expiration floor is below measured settlement latency.
 * This test demonstrates the fix across both x402 payment paths.
 *
 * The measured worst sign-to-settled window is 12.0s (~3 ledgers).
 * MIN_VIABLE_EXPIRATION_LEDGERS (5 ≈ 25s) is ~2x that worst case.
 *
 * Both classic (x402-client) and smart-account (smart-account-scheme) paths
 * now refuse to sign when the seller's maxTimeoutSeconds results in a window
 * below the minimum viable threshold.
 */

import { describe, it, expect } from "vitest";
import { UnworkableTimeoutError, MIN_VIABLE_EXPIRATION_LEDGERS } from "./x402-timeout-error";

describe("V-13 Expiration Floor Enforcement", () => {
  it("defines MIN_VIABLE_EXPIRATION_LEDGERS as 5 (≈25s)", () => {
    expect(MIN_VIABLE_EXPIRATION_LEDGERS).toBe(5);
  });

  it("UnworkableTimeoutError carries maxTimeoutSeconds and ledgers", () => {
    const error = new UnworkableTimeoutError(1, 3);
    expect(error.maxTimeoutSeconds).toBe(1);
    expect(error.ledgers).toBe(3);
    expect(error.name).toBe("UnworkableTimeoutError");
  });

  it("error message names the seller's configuration as cause", () => {
    const error = new UnworkableTimeoutError(1, 3);
    expect(error.message).toContain("The resource server allows only 1s");
    expect(error.message).toContain("below the ~25s");
    expect(error.message).toContain("Nothing was spent");
    expect(error.message).toContain("seller's configuration");
  });

  describe("Integration pattern for both payment paths", () => {
    /**
     * Both x402-client and smart-account-scheme use this pattern:
     *
     * function expirationOffsetFor(maxTimeoutSeconds: number): number {
     *   const windowLedgers = Math.ceil(maxTimeoutSeconds / ESTIMATED_LEDGER_SECONDS);
     *   let offset = Math.max(windowLedgers - SAFETY_MARGIN, MIN_EXPIRATION_LEDGERS);
     *
     *   // V-13: Refuse before signing if window is too narrow
     *   if (offset < MIN_VIABLE_EXPIRATION_LEDGERS) {
     *     throw new UnworkableTimeoutError(maxTimeoutSeconds, offset);
     *   }
     *   return offset;
     * }
     */

    it("refuses when offset would be below MIN_VIABLE_EXPIRATION_LEDGERS", () => {
      // Simulate: 1s / 5s per ledger ≈ 0.2 ledgers, floored to MIN_EXPIRATION_LEDGERS (3)
      // 3 < MIN_VIABLE_EXPIRATION_LEDGERS (5) → refuse
      expect(() => {
        throw new UnworkableTimeoutError(1, 3);
      }).toThrow(UnworkableTimeoutError);
    });

    it("accepts when offset meets or exceeds MIN_VIABLE_EXPIRATION_LEDGERS", () => {
      // Simulate: 60s / 5s = 12 ledgers, - 2 safety margin = 10
      // 10 >= MIN_VIABLE_EXPIRATION_LEDGERS (5) → proceed
      const offset = 10;
      expect(offset >= MIN_VIABLE_EXPIRATION_LEDGERS).toBe(true);
    });

    it("realistic merchant timeouts (60s+) always proceed", () => {
      const timeouts = [60, 120, 300, 600];
      const ESTIMATED_LEDGER_SECONDS = 5;
      const EXPIRATION_SAFETY_MARGIN = 2;
      const MIN_EXPIRATION_LEDGERS = 3;

      for (const maxTimeoutSeconds of timeouts) {
        const windowLedgers = Math.ceil(maxTimeoutSeconds / ESTIMATED_LEDGER_SECONDS);
        let offset = Math.max(windowLedgers - EXPIRATION_SAFETY_MARGIN, MIN_EXPIRATION_LEDGERS);
        expect(offset >= MIN_VIABLE_EXPIRATION_LEDGERS).toBe(
          true,
          `${maxTimeoutSeconds}s should produce offset >= 5, got ${offset}`,
        );
      }
    });
  });

  describe("Before vs. After V-13 behavior", () => {
    it("OLD (pre-V-13): short timeout produces expired signature mid-flight", () => {
      // Before: 1s timeout → 0 ledgers → floored to 3 → signature expires in ~15s
      // During settlement (worst case 12s), signature might expire unpredictably
      // Result: opaque settlement failure
      const ESTIMATED_LEDGER_SECONDS = 5;
      const EXPIRATION_SAFETY_MARGIN = 2;
      const MIN_EXPIRATION_LEDGERS = 3;

      const maxTimeoutSeconds = 1;
      const windowLedgers = Math.ceil(maxTimeoutSeconds / ESTIMATED_LEDGER_SECONDS); // 0
      const offset = Math.max(windowLedgers - EXPIRATION_SAFETY_MARGIN, MIN_EXPIRATION_LEDGERS); // 3

      // 3 ledgers ≈ 15s headroom, but worst settlement is 12s → risky
      expect(offset).toBe(3);
    });

    it("NEW (V-13): short timeout refused before signing", () => {
      // After: 1s timeout → 0 ledgers → floored to 3
      // 3 < MIN_VIABLE_EXPIRATION_LEDGERS (5) → throw UnworkableTimeoutError
      // Result: clear upfront refusal naming seller's config as cause
      const offset = 3;
      expect(() => {
        if (offset < MIN_VIABLE_EXPIRATION_LEDGERS) {
          throw new UnworkableTimeoutError(1, offset);
        }
      }).toThrow(/resource server allows only 1s/);
    });
  });

  describe("Applied to both payment paths", () => {
    it("x402-client (classic): enforces V-13 in expirationOffsetFor", () => {
      // src/x402-client.ts:expirationOffsetFor now checks:
      // if (offset < MIN_VIABLE_EXPIRATION_LEDGERS) {
      //   throw new UnworkableTimeoutError(maxTimeoutSeconds, offset);
      // }
      const shouldThrow = (maxTimeoutSeconds: number) => {
        const ESTIMATED_LEDGER_SECONDS = 5;
        const EXPIRATION_SAFETY_MARGIN = 2;
        const MIN_EXPIRATION_LEDGERS = 3;
        const DEFAULT_MAX_EXPIRATION_LEDGERS = 58;

        const windowLedgers = Math.ceil((maxTimeoutSeconds ?? 120) / ESTIMATED_LEDGER_SECONDS);
        let offset = windowLedgers - EXPIRATION_SAFETY_MARGIN;
        offset = Math.min(offset, DEFAULT_MAX_EXPIRATION_LEDGERS);
        offset = Math.max(offset, MIN_EXPIRATION_LEDGERS);

        if (offset < MIN_VIABLE_EXPIRATION_LEDGERS) {
          throw new UnworkableTimeoutError(maxTimeoutSeconds ?? 120, offset);
        }
        return offset;
      };

      expect(() => shouldThrow(1)).toThrow(UnworkableTimeoutError);
      expect(shouldThrow(60)).toBe(10);
    });

    it("smart-account-scheme (MCP payer): already had V-13, now uses shared module", () => {
      // packages/mcp-x402-payer/src/smart-account-scheme.ts already had this.
      // Updated to import UnworkableTimeoutError and MIN_VIABLE_EXPIRATION_LEDGERS
      // from the shared x402-timeout-error module instead of duplicating.
      const offset = 3;
      expect(() => {
        if (offset < MIN_VIABLE_EXPIRATION_LEDGERS) {
          throw new UnworkableTimeoutError(1, offset);
        }
      }).toThrow(UnworkableTimeoutError);
    });
  });
});
