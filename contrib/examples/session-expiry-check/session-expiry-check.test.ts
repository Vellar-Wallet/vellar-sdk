import { describe, expect, it } from "vitest";
import { checkExpiry } from "./session-expiry-check";

describe("checkExpiry", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("reports a past timestamp as expired", () => {
    expect(checkExpiry("2020-01-01T00:00:00.000Z", now)).toBe("expired");
  });

  it("reports a future timestamp as active", () => {
    expect(checkExpiry("2030-01-01T00:00:00.000Z", now)).toBe("active");
  });

  it("treats an expiry exactly at now as expired", () => {
    expect(checkExpiry(now.toISOString(), now)).toBe("expired");
  });

  it("rejects an invalid timestamp", () => {
    expect(() => checkExpiry("not-a-date", now)).toThrow(RangeError);
  });
});
