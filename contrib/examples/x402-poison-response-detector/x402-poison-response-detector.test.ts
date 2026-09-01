import { describe, it, expect, vi } from "vitest";
import { PoisonResponseDetector, PoisonResponseError } from "./x402-poison-response-detector";

describe("Issue #246 — x402 Poison Response Detection", () => {
  it("throws PoisonResponseError when consecutive parse failures reach threshold", () => {
    const logger = vi.fn();
    const detector = new PoisonResponseDetector(3, logger);

    detector.recordParseFailure("https://seller.test/api", "Invalid JSON syntax");
    expect(detector.getFailures("https://seller.test/api")).toBe(1);

    detector.recordParseFailure("https://seller.test/api", "Corrupted payload");
    expect(detector.getFailures("https://seller.test/api")).toBe(2);

    expect(() =>
      detector.recordParseFailure("https://seller.test/api", "Empty body")
    ).toThrow(PoisonResponseError);

    expect(logger).toHaveBeenCalledWith("https://seller.test/api", 3);
  });

  it("resets failure counter on parse success", () => {
    const detector = new PoisonResponseDetector(3);

    detector.recordParseFailure("https://seller.test/api", "Bad format");
    expect(detector.getFailures("https://seller.test/api")).toBe(1);

    detector.recordParseSuccess("https://seller.test/api");
    expect(detector.getFailures("https://seller.test/api")).toBe(0);
  });
});
