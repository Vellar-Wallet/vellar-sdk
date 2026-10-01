import { describe, expect, it } from "vitest";
import { expirationOffsetFor } from "./expiration";

describe("contrib expiration override reference", () => {
  it("preserves the 5-second default", () => {
    expect(expirationOffsetFor(120)).toBe(22);
    expect(expirationOffsetFor(30)).toBe(4);
    expect(expirationOffsetFor(undefined)).toBe(22);
  });

  it("allows a slower network estimate to be configured", () => {
    expect(expirationOffsetFor(120, { ledgerSecondsEstimate: 6 })).toBe(18);
  });

  it("keeps the safety margin and bounds under a seller-controlled timeout", () => {
    expect(expirationOffsetFor(120, { ledgerSecondsEstimate: 6, safetyMarginLedgers: 3 })).toBe(17);
    expect(expirationOffsetFor(86_400)).toBe(58);
  });

  it("validates the tunable values", () => {
    expect(() => expirationOffsetFor(120, { ledgerSecondsEstimate: 0 })).toThrow(RangeError);
    expect(() => expirationOffsetFor(120, { ledgerSecondsEstimate: Number.NaN })).toThrow(RangeError);
    expect(() => expirationOffsetFor(-1)).toThrow(RangeError);
    expect(() => expirationOffsetFor(120, { minExpirationLedgers: 10, maxExpirationLedgers: 9 })).toThrow(RangeError);
  });
});